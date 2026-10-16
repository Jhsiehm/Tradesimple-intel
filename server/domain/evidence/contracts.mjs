import { tickerBySymbol } from "../../lib/db.mjs";
import { usaspendingSearch, USASPENDING, usaspendingGate } from "../../feeds/usaspending.mjs";
import { fetchJsonRetry } from "../../lib/http.mjs";
import { hashOf, putDataset } from "../research-store.mjs";
import { identities } from "../research-events.mjs";
import { months, isoDate, normalizeContract, availableDate, obligationFeatures } from "../../../shared/evidence.mjs";
import { evidenceStore, saveJob, getJob, jobs, records, putBlob, blob, putRecord, newJobId } from "./store.mjs";
const active = new WeakMap();
const FIELDS = [
  "Award ID",
  "Recipient Name",
  "Recipient UEI",
  "Action Date",
  "Transaction Amount",
  "Transaction Description",
  "Awarding Agency",
  "Awarding Sub Agency",
  "Mod",
  "generated_internal_id",
  "Primary Place of Performance",
  "NAICS",
  "PSC",
  "Award Type",
  "Action Type",
  "recipient_id",
  "Funding Agency",
  "Funding Sub Agency",
  "awarding_agency_id",
  "Recipient Location",
];
const source = "USAspending prime contract transactions";
export const client = {
  search: usaspendingSearch,
  children: (uei) =>
    fetchJsonRetry(
      `${USASPENDING}/recipient/children/${encodeURIComponent(uei)}/`,
      {},
      { gate: usaspendingGate, retries: 1, timeoutMs: 30000 },
    ),
};
function filters(job, p) {
  return {
    award_type_codes: ["A", "B", "C", "D"],
    recipient_search_text: job.parents.filter((x) => x.symbol === p.symbol).map((x) => x.uei),
    time_period: [{ start_date: p.from, end_date: p.to }],
  };
}
export function createContractJob(db, body) {
  evidenceStore(db);
  const symbols = [
    ...new Set(
      (Array.isArray(body.symbols) ? body.symbols : String(body.symbols || "").split(/[\s,]+/))
        .map((x) => String(x).toUpperCase())
        .filter(Boolean),
    ),
  ];
  if (!symbols.length || symbols.length > 40) throw new Error("Choose 1–40 registered tickers.");
  if (
    !isoDate(body.from) ||
    !isoDate(body.to) ||
    body.from < "2007-10-01" ||
    body.to > new Date().toISOString().slice(0, 10)
  )
    throw new Error(
      "Transaction search supports action dates from 2007-10-01 through today. Earlier history requires an audited bulk import.",
    );
  const ranges = months(body.from, body.to);
  if (ranges.length * symbols.length > 600)
    throw new Error("At most 600 ticker-month partitions per job. Split a larger retrieval into date ranges.");
  const parents = symbols.flatMap((symbol) => {
    const t = tickerBySymbol(db, symbol);
    if (!t) throw new Error(`Unknown ticker: ${symbol}`);
    return (t.contractParents || [])
      .filter((x) => x.uei)
      .map((x) => ({
        symbol,
        name: x.name,
        uei: x.uei.toUpperCase(),
        relationship: "curated parent",
        basis: "data/tickers.json",
        historicalOwnership: "unverified",
      }));
  });
  const id = newJobId();
  const now = new Date().toISOString();
  return saveJob(db, {
    id,
    title:
      String(body.title || "")
        .trim()
        .slice(0, 200) || "USAspending · " + symbols.join(", "),
    source,
    symbols,
    from: body.from,
    to: body.to,
    createdAt: now,
    status: "queued",
    parents,
    mapping: [],
    mappingReady: false,
    mappingWarnings: [],
    mappingHash: null,
    error: null,
    datasetId: null,
    partitions: symbols.flatMap((symbol) =>
      ranges.map((r) => ({
        id: `${symbol}:${r.from}`,
        symbol,
        ...r,
        page: 1,
        state: parents.some((p) => p.symbol === symbol) ? "pending" : "unmapped",
        received: 0,
        hashes: [],
        expected: null,
        after: null,
        error: null,
      })),
    ),
  });
}
export function jobView(db, id) {
  const job = getJob(db, id),
    all = records(db, id);
  const keys = new Map();
  for (const r of all) keys.set(r.recordKey || r.rawHash, (keys.get(r.recordKey || r.rawHash) || 0) + 1);
  const collisions = all.filter((r) => keys.get(r.recordKey || r.rawHash) > 1).length;
  const runtime = active.get(db);
  return {
    ...job,
    status: job.status === "running" && !runtime?.has(id) ? "interrupted" : job.status,
    coverage: {
      partitions: job.partitions.length,
      completed: job.partitions.filter((p) => p.state === "complete").length,
      received: job.partitions.reduce((n, p) => n + p.received, 0),
      versions: all.length,
      ambiguousVersions: collisions,
      unmapped: all.filter((r) => !r.symbol).length,
      missingAmounts: all.filter((r) => r.amount == null).length,
      missingDates: all.filter((r) => !r.actionDate).length,
      historicalOwnership: "unverified",
      timing: "Public availability not established by retrieval.",
    },
    features: obligationFeatures(all.filter((r) => keys.get(r.recordKey || r.rawHash) === 1 && r.symbol)),
    preview: all.slice(0, 100),
    warnings: [
      "Complete means retrieved and count-reconciled within the declared scope, not all company spending or point-in-time history.",
      "Current parent/subsidiary mappings do not establish historical ownership.",
      "Same-count upstream revisions can escape count reconciliation. Raw pages are frozen; ambiguous versions are excluded.",
      ...job.mappingWarnings,
    ],
  };
}
export function listContractJobs(db) {
  return jobs(db).map((j) => {
    const { parents, mapping, partitions, ...rest } = j;
    return {
      ...rest,
      status: j.status === "running" && !active.get(db)?.has(j.id) ? "interrupted" : j.status,
      progress: { done: partitions.filter((p) => p.state === "complete").length, total: partitions.length },
    };
  });
}
export function pauseContractJob(db, id) {
  const job = getJob(db, id);
  if (job.status === "complete")
    throw new Error("Completed evidence jobs are immutable; create a new retrieval to refresh them.");
  job.status = "paused";
  return saveJob(db, job);
}
export async function workContractJob(db, id, { api = client, pageBudget = 20 } = {}) {
  let running = active.get(db);
  if (!running) {
    running = new Set();
    active.set(db, running);
  }
  if (running.has(id)) return;
  if (running.size >= 2) throw new Error("Two evidence jobs are already running.");
  let job = getJob(db, id);
  if (job.status === "complete") return;
  running.add(id);
  job.status = "running";
  job.error = null;
  saveJob(db, job);
  try {
    if (!job.mappingReady) {
      const mapping = [...job.parents],
        warnings = [],
        proofs = [];
      for (const parent of job.parents) {
        if (getJob(db, id).status === "paused") return;
        try {
          const children = await api.children(parent.uei);
          if (getJob(db, id).status === "paused") return;
          if (!Array.isArray(children)) throw new Error("Unexpected child-recipient response.");
          proofs.push(putBlob(db, { parent: parent.uei, response: children, observedAt: new Date().toISOString() }));
          for (const c of children)
            if (c.uei)
              mapping.push({
                symbol: parent.symbol,
                uei: String(c.uei).toUpperCase(),
                name: c.name,
                parent: parent.uei,
                relationship: "source-reported child",
                basis: proofs.at(-1),
                historicalOwnership: "unverified",
              });
        } catch (e) {
          warnings.push(`${parent.uei}: child discovery unavailable (${e.message}); only known mappings used.`);
        }
      }
      job.mapping = [...new Map(mapping.map((m) => [`${m.symbol}:${m.uei}`, m])).values()];
      job.mappingWarnings = warnings;
      job.mappingHash = putBlob(db, { mapping: job.mapping, proofs, observedAt: new Date().toISOString() });
      db.prepare("INSERT OR IGNORE INTO research.evidence_mappings VALUES (?, ?)").run(
        job.mappingHash,
        JSON.stringify({ mapping: job.mapping, proofs }),
      );
      job.mappingReady = true;
      saveJob(db, job);
    }
    let pages = 0;
    for (const p of job.partitions) {
      if (p.state === "complete" || p.state === "unmapped") continue;
      if (getJob(db, id).status === "paused") return;
      if (p.state === "review") continue;
      p.error = null;
      const count = async () => {
        const r = await api.search("spending_by_transaction_count", { filters: filters(job, p) });
        const n = r?.results?.contracts;
        if (!Number.isSafeInteger(n) || n < 0) throw new Error("Transaction count unavailable.");
        return n;
      };
      try {
        if (p.expected == null) {
          p.expected = await count();
          saveJob(db, job);
        }
        while (p.page !== null) {
          if (getJob(db, id).status === "paused") return;
          if (pages >= pageBudget) {
            job.status = "paused";
            job.error = "Page budget reached. Resume to continue from the saved checkpoint.";
            saveJob(db, job);
            return;
          }
          if (recordsCount(db, id) > 100000)
            throw new Error("100,000-record job limit reached. Split this retrieval into smaller ranges.");
          const request = {
            filters: filters(job, p),
            fields: FIELDS,
            limit: 100,
            page: p.page,
            sort: "Action Date",
            order: "asc",
          };
          const response = await api.search("spending_by_transaction", request);
          if (getJob(db, id).status === "paused") {
            job = getJob(db, id);
            return;
          }
          if (
            !Array.isArray(response?.results) ||
            response.results.length > 100 ||
            typeof response.page_metadata?.hasNext !== "boolean" ||
            response.page_metadata.page !== p.page
          )
            throw new Error("Invalid transaction page or pagination metadata.");
          const hash = hashOf(response.results);
          const next = response.page_metadata.hasNext ? response.page_metadata.next : null;
          if (p.hashes.includes(hash) && response.results.length)
            throw new Error("Repeated page detected. Retrieval is incomplete.");
          if (next !== null && (!Number.isSafeInteger(next) || next !== p.page + 1 || !response.results.length))
            throw new Error("Invalid next page. Retrieval is incomplete.");
          const observedAt = new Date().toISOString();
          db.exec("BEGIN IMMEDIATE");
          try {
            const rawPage = putBlob(db, { request, response, observedAt });
            db.prepare("INSERT INTO research.evidence_observations VALUES (?, ?, ?, ?, ?)").run(
              id,
              p.id,
              p.page,
              rawPage,
              observedAt,
            );
            for (const raw of response.results)
              putRecord(db, job, p.id, raw, normalizeContract(raw, job.mapping, observedAt));
            p.received += response.results.length;
            p.hashes.push(hash);
            p.page = next;
            p.state = next === null ? "validating" : "fetching";
            saveJob(db, job);
            db.exec("COMMIT");
          } catch (e) {
            db.exec("ROLLBACK");
            throw e;
          }
          pages++;
        }
        p.after = await count();
        if (getJob(db, id).status === "paused") {
          job = getJob(db, id);
          return;
        }
        const unique = db
          .prepare(
            "SELECT count(*) AS n FROM research.evidence_records WHERE job_id=? AND json_extract(body,'$.partition')=?",
          )
          .get(id, p.id).n;
        p.state = p.expected === p.after && p.received === p.after && unique === p.after ? "complete" : "review";
        if (p.state === "review")
          p.error = `Counts need review: before ${p.expected}, after ${p.after}, received ${p.received}, unique versions ${unique}. Refresh as a new job to reconcile upstream changes.`;
      } catch (e) {
        p.state = "failed";
        p.error = e.message;
      }
      saveJob(db, job);
    }
    job.status = job.partitions.every((p) => p.state === "complete") ? "complete" : "partial";
    saveJob(db, job);
  } catch (e) {
    job.status = "failed";
    job.error = e.message;
    saveJob(db, job);
  } finally {
    running.delete(id);
  }
}
function recordsCount(db, id) {
  return db.prepare("SELECT count(*) AS n FROM research.evidence_records WHERE job_id=?").get(id).n;
}
export function startContractJob(db, id) {
  const job = getJob(db, id);
  if (job.status === "complete") return jobView(db, id);
  void workContractJob(db, id).catch((e) => {
    const j = getJob(db, id);
    j.status = "failed";
    j.error = e.message;
    saveJob(db, j);
  });
  return jobView(db, id);
}
export function freezeContractJob(db, id, body = {}) {
  const job = jobView(db, id);
  if (["running", "queued", "interrupted"].includes(job.status))
    throw new Error("Pause or finish retrieval before freezing.");
  if (job.status !== "complete" && body.allowPartial !== true)
    throw new Error("Retrieval is incomplete. Explicitly acknowledge partial evidence or finish retrieval.");
  const policy = body.policy;
  if (!policy || !["observed", "assumed", "verified"].includes(policy.mode)) throw new Error("Choose a timing policy.");
  if (
    policy.mode === "assumed" &&
    (!Number.isInteger(policy.defenseDays) ||
      policy.defenseDays < 1 ||
      policy.defenseDays > 365 ||
      !Number.isInteger(policy.civilianDays) ||
      policy.civilianDays < 1 ||
      policy.civilianDays > 365)
  )
    throw new Error("Assumed delays must be 1–365 whole days.");
  if (!isoDate(body.from) || !isoDate(body.to) || body.from > body.to)
    throw new Error("Specify a valid public-availability date range.");
  if (body.to > new Date().toISOString().slice(0, 10))
    throw new Error("Public-availability end date cannot be in the future.");
  const cooldown = body.cooldownDays ?? 30;
  if (!Number.isInteger(cooldown) || cooldown < 0 || cooldown > 365) throw new Error("Cooldown must be 0–365 days.");
  const identity = identities(db),
    by = new Map(identity.rows.map((x) => [x.symbol, x]));
  const all = records(db, id),
    counts = new Map();
  for (const r of all) counts.set(r.recordKey, (counts.get(r.recordKey) || 0) + 1);
  const dropped = {},
    drop = (k) => {
      dropped[k] = (dropped[k] || 0) + 1;
    };
  const eligible = [];
  for (const r of all) {
    if (!r.recordKey || counts.get(r.recordKey) !== 1) {
      drop("ambiguousIdentity");
      continue;
    }
    if (!r.symbol || !by.has(r.symbol)) {
      drop("unmappedRecipient");
      continue;
    }
    if (!r.actionDate || r.amount == null) {
      drop("missingDateOrAmount");
      continue;
    }
    if (policy.mode === "assumed" && !r.agency) {
      drop("missingAgencyTiming");
      continue;
    }
    if (!(r.amount > 0)) {
      drop("nonPositiveObligation");
      continue;
    }
    const date = availableDate(r, policy);
    if (!date) {
      drop("unverifiedPublication");
      continue;
    }
    if (date < r.actionDate) {
      drop("availabilityBeforeAction");
      continue;
    }
    if (date < body.from || date > body.to || date > new Date().toISOString().slice(0, 10)) {
      drop("outsidePublicWindow");
      continue;
    }
    eligible.push({ ...r, availableAt: date });
  }
  eligible.sort((a, b) => a.availableAt.localeCompare(b.availableAt) || a.recordKey.localeCompare(b.recordKey));
  const last = new Map(),
    events = [];
  for (const r of eligible) {
    const day = Date.parse(r.availableAt) / 86400000;
    if (last.has(r.symbol) && day - last.get(r.symbol) < cooldown) {
      drop("cooldown");
      continue;
    }
    last.set(r.symbol, day);
    events.push({
      schemaVersion: 1,
      id: `usa:${hashOf(r.recordKey)}`,
      sourceRecordId: r.recordKey,
      source,
      sourceUrl: r.sourceUrl,
      entity: by.get(r.symbol),
      eventAt: r.actionDate,
      availableAt: r.availableAt,
      availabilityPrecision: "day",
      availabilityBasis:
        policy.mode === "assumed"
          ? "assumed-publication-lag"
          : policy.mode === "observed"
            ? "first-observed-version"
            : "verified-publication",
      ingestedAt: r.firstObservedAt,
      identityVersion: identity.version,
      side: "buy",
      value: r.amount,
      original: r,
    });
  }
  // A valid frozen evidence set may contain zero signals; preserve that negative coverage result for diagnosis.
  const eventDates = events.map((e) => e.availableAt).sort();
  const manifest = {
    jobId: id,
    sourceFamily: "contracts",
    mappingHash: job.mappingHash,
    scope: { symbols: job.symbols, actionFrom: job.from, actionTo: job.to, publicFrom: body.from, publicTo: body.to },
    policy,
    cooldownDays: cooldown,
    signal: "positive-obligation; first eligible per ticker per cooldown interval",
    coverage: job.coverage,
    partitions: job.partitions,
    dropped,
    versions: all.map((r) => ({ recordKey: r.recordKey, versionHash: r.versionHash, rawHash: r.rawHash })),
    features: job.features,
  };
  const caveats = [
    ...job.warnings,
    `Timing: ${policy.mode}; first-observed dates describe our collector, not original publication.`,
    `Signal: positive obligations, ${cooldown}-day cooldown. Negative/zero transactions remain in raw evidence but are not buy signals.`,
    ...(job.status === "complete" ? [] : ["PARTIAL retrieval explicitly accepted; missing records can bias results."]),
  ];
  const rawContent = JSON.stringify({ manifest, records: all.map((r) => ({ ...r, raw: blob(db, r.rawHash) })) });
  const dataset = putDataset(
    db,
    `USAspending ${job.symbols.join(", ")} ${job.from}–${job.to}`,
    {
      schemaVersion: 1,
      source,
      sourceFamily: "contracts",
      format: "evidence",
      rawContent,
      rawHash: hashOf(rawContent),
      identity,
      events,
      manifest,
      coverage: {
        received: all.length,
        valid: all.length,
        rejected: 0,
        from: eventDates[0] || null,
        to: eventDates.at(-1) || null,
        missingSourceUrls: all.filter((e) => !e.sourceUrl).length,
      },
      caveats,
    },
    hashOf({ manifest, events }),
  );
  const stored = getJob(db, id);
  stored.datasetId = dataset.id;
  saveJob(db, stored);
  return dataset;
}
export function exportJob(db, id) {
  const job = jobView(db, id);
  const pages = db
    .prepare("SELECT hash FROM research.evidence_observations WHERE job_id=? ORDER BY partition_id,page")
    .all(id);
  return {
    schemaVersion: 1,
    job,
    records: records(db, id).map((r) => ({ ...r, raw: blob(db, r.rawHash) })),
    pages: pages.map((p) => ({ hash: p.hash, ...blob(db, p.hash) })),
  };
}
