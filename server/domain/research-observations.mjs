import { verifyConnectorEvidence } from "./research-connector-evidence.mjs";
/** Immutable numeric observations and explicit deterministic threshold-to-signal transformations. */
import { researchStore, hashOf, newId, putDataset } from "./research-store.mjs";
import { parseCsv, timestamp, IMPORT_LIMIT, ROW_LIMIT, prepareDataset } from "./research-events.mjs";
const fields = [
  "id",
  "entityId",
  "metric",
  "unit",
  "value",
  "eventAt",
  "availableAt",
  "sourceUrl",
  "observationId",
  "status",
  "observationType",
  "targetAt",
];
const ready = new WeakSet();
function ensure(db) {
  researchStore(db);
  if (ready.has(db)) return;
  db.exec(`CREATE TABLE IF NOT EXISTS research.observation_snapshots (id TEXT PRIMARY KEY,name TEXT NOT NULL,version INTEGER NOT NULL,created_at TEXT NOT NULL,content_hash TEXT NOT NULL,body_hash TEXT NOT NULL,body TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS research.observation_snapshots_update BEFORE UPDATE ON observation_snapshots BEGIN SELECT RAISE(ABORT,'Observations are immutable'); END;
CREATE TRIGGER IF NOT EXISTS research.observation_snapshots_delete BEFORE DELETE ON observation_snapshots BEGIN SELECT RAISE(ABORT,'Observations are immutable'); END;`);
  ready.add(db);
}
function forecastKnownBeforeTarget(row) {
  if (row.observationType !== "forecast") return true;
  const publication = timestamp(row.availableAt);
  return (
    Date.parse(publication.value) + (publication.precision === "day" ? 86400000 - 1 : 0) < Date.parse(row.targetAt)
  );
}
function text(v, name, max) {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    throw Error(`${name} is required (up to ${max} characters).`);
  return v.trim();
}
function decode(row) {
  if (!row) throw Error("Observation snapshot not found.");
  if (hashOf(row.body) !== row.body_hash) throw Error("Observation checksum mismatch.");
  const s = JSON.parse(row.body);
  if (
    hashOf(s.rawContent) !== s.rawHash ||
    hashOf({ raw: s.rawContent, mapping: s.mapping, source: s.source, ownership: s.ownership, license: s.license }) !==
      s.contentHash
  )
    throw Error("Observation source checksum mismatch.");
  return s;
}
export function prepareObservations(body, { now = new Date().toISOString() } = {}) {
  const name = text(body?.name, "Dataset name", 120),
    source = text(body?.source, "Source", 300),
    ownership = text(body?.ownership, "Ownership label", 300),
    license = text(body?.license, "License or usage conditions", 2000);
  if (typeof body.content !== "string" || Buffer.byteLength(body.content) > IMPORT_LIMIT)
    throw Error("Import must be at most 2 MiB.");
  if (body.mapping != null && (!body.mapping || typeof body.mapping !== "object" || Array.isArray(body.mapping)))
    throw Error("Column mapping must be an object.");
  let parsed;
  if (body.format === "csv") parsed = parseCsv(body.content);
  else if (body.format === "json") {
    const j = JSON.parse(body.content);
    verifyConnectorEvidence(j);
    const rows = Array.isArray(j) ? j : j?.items;
    if (!Array.isArray(rows) || rows.some((r) => !r || typeof r !== "object" || Array.isArray(r)))
      throw Error("JSON requires row objects.");
    parsed = { rows, headers: [...new Set(rows.flatMap(Object.keys))] };
  } else throw Error("Choose csv or json.");
  if (!parsed.rows.length || parsed.rows.length > ROW_LIMIT) throw Error("Import between 1 and 5,000 observations.");
  const mapping = Object.fromEntries(fields.map((f) => [f, body.mapping?.[f] || f]));
  if (Object.values(mapping).some((v) => typeof v !== "string")) throw Error("Mapped column names must be strings.");
  const events = [],
    errors = [],
    ids = new Set(),
    identities = new Map();
  let errorCount = 0;
  const error = (row, field, message) => {
    errorCount++;
    if (errors.length < 100) errors.push({ row, field, message });
  };
  parsed.rows.forEach((raw, i) => {
    const row = i + 1,
      before = errorCount,
      get = (f) => raw[mapping[f]],
      id = String(get("id") ?? "").trim(),
      entityId = String(get("entityId") ?? "").trim(),
      metric = String(get("metric") ?? "").trim(),
      unit = String(get("unit") ?? "").trim();
    if (!id || id.length > 200 || ids.has(id)) error(row, "id", "Use a unique record ID up to 200 characters.");
    ids.add(id);
    if (!/^[a-z][a-z0-9-]*:[A-Za-z0-9._:-]+$/.test(entityId) || entityId.length > 200)
      error(row, "entityId", "Use an explicit typed identifier such as facility:plant-1 or jurisdiction:US-NY.");
    if (typeof get("metric") !== "string" || !metric || metric.length > 100)
      error(row, "metric", "Name the measured quantity (up to 100 characters).");
    if (typeof get("unit") !== "string" || !unit || unit.length > 60)
      error(row, "unit", "Specify the unit; use count or ratio for unitless quantities.");
    const observationId = get("observationId") == null || get("observationId") === "" ? id : get("observationId"),
      status = get("status") == null || get("status") === "" ? "asserted" : get("status");
    if (typeof observationId !== "string" || !observationId.trim() || observationId.length > 200)
      error(row, "observationId", "Use a stable observation ID up to 200 characters, shared by its revisions.");
    if (!["asserted", "retracted"].includes(status)) error(row, "status", "Choose asserted or retracted.");
    const rawValue = get("value"),
      value =
        typeof rawValue === "number" || (typeof rawValue === "string" && rawValue.trim()) ? Number(rawValue) : NaN;
    if (status === "retracted" && rawValue != null && rawValue !== "")
      error(row, "value", "Retractions must leave value empty.");
    if (status !== "retracted" && !Number.isFinite(value))
      error(row, "value", "A finite numeric observation is required; zero and negative values are allowed.");
    const observationType =
        get("observationType") == null || get("observationType") === "" ? "realized" : get("observationType"),
      forecast = observationType === "forecast";
    if (!["realized", "forecast"].includes(observationType))
      error(row, "observationType", "Choose realized or forecast.");
    const target = forecast ? timestamp(get("targetAt")) : null;
    if (forecast && !target) error(row, "targetAt", "Forecasts require a target date or UTC ISO timestamp.");
    if (!forecast && get("targetAt") != null && get("targetAt") !== "")
      error(row, "targetAt", "Only forecasts may carry a target date.");
    const event = timestamp(get("eventAt")),
      available = timestamp(get("availableAt"));
    if (forecast && event && target && Date.parse(event.value) >= Date.parse(target.value))
      error(row, "targetAt", "The forecast target must be after its issuance (eventAt).");
    if (!event) error(row, "eventAt", "Use a date or UTC ISO timestamp.");
    if (!available)
      error(row, "availableAt", "Record when the observation became available; event time is never substituted.");
    if (event && available && Date.parse(available.value) < Date.parse(event.value))
      error(row, "availableAt", "Availability cannot precede the measurement event or forecast issuance.");
    if (
      available &&
      (available.precision === "day"
        ? available.value > now.slice(0, 10)
        : Date.parse(available.value) > Date.parse(now))
    )
      error(row, "availableAt", "Future availability is not allowed.");
    const sourceUrl = String(get("sourceUrl") ?? "").trim();
    try {
      const u = new URL(sourceUrl);
      if (!["http:", "https:"].includes(u.protocol) || u.username || u.password || sourceUrl.length > 2000)
        throw Error();
    } catch {
      error(row, "sourceUrl", "Provide an HTTP(S) evidence URL without credentials.");
    }
    const identity = JSON.stringify([
      entityId,
      metric,
      unit,
      event?.value,
      ...(forecast ? [observationType, target?.value] : []),
    ]);
    if (typeof observationId === "string") {
      const prior = identities.get(observationId.trim());
      if (prior && prior !== identity)
        error(
          row,
          "observationId",
          "Revisions must retain entity, metric, unit, observation type, issuance/event time and forecast target. Retract the old observation and create a new ID to change its identity.",
        );
      identities.set(observationId.trim(), identity);
    }
    if (errorCount === before)
      events.push({
        ...(forecast ? { observationType: "forecast", targetAt: target.value } : {}),
        id,
        observationId: observationId.trim(),
        status,
        entityId,
        metric,
        unit,
        value: status === "retracted" ? null : value,
        eventAt: event.value,
        availableAt: available.value,
        availabilityPrecision: available.precision,
        sourceUrl,
        original: raw,
      });
  });
  const payload = {
    schemaVersion: 3,
    name,
    source,
    ownership,
    license,
    format: body.format,
    mapping,
    rawContent: body.content,
    rawHash: hashOf(body.content),
    events,
    coverage: {
      received: parsed.rows.length,
      valid: events.length,
      rejected: parsed.rows.length - events.length,
      entities: new Set(events.map((e) => e.entityId)).size,
      metrics: [...new Set(events.map((e) => e.metric))],
    },
    availabilityBasis: "importer-asserted; not independently verified",
    caveats: [
      "For forecasts, eventAt is issuance and targetAt is the future target. A new issuance needs a new observationId; corrections retain issuance and target. Realized values are separate observations. Revisions share an observationId within this snapshot; independent snapshot versions are not automatically merged.",
      "Date-only publications become known at the end of the UTC day. Tied assertions at a selected publication time are ambiguous and excluded.",
      "Forecast signals require their first publication to precede the target start. Later corrections may be archived after that target but never replace first-publication signals. Historical threshold signals use first publications. Corrections and retractions are available in dated lookups and do not rewrite previously published signals.",
      "Entity identities, availability and usage rights are importer assertions, not independently verified.",
      "Ownership and license labels do not implement team access controls.",
    ],
  };
  return {
    ok: !errorCount,
    name,
    headers: parsed.headers,
    errors,
    errorCount,
    preview: events.slice(0, 10),
    coverage: payload.coverage,
    payload,
    contentHash: hashOf({ raw: body.content, mapping, source, ownership, license }),
  };
}
export function importObservations(db, body) {
  return savePreparedObservations(db, prepareObservations(body));
}
function savePreparedObservations(db, p) {
  ensure(db);
  if (!p.ok) return { ...p, payload: undefined };
  const old = db
    .prepare("SELECT body,body_hash FROM research.observation_snapshots WHERE name=? AND content_hash=?")
    .get(p.name, p.contentHash);
  if (old) return { ok: true, snapshot: decode(old) };
  const version = db
    .prepare("SELECT COALESCE(MAX(version),0)+1 AS n FROM research.observation_snapshots WHERE name=?")
    .get(p.name).n;
  const s = {
    ...p.payload,
    id: newId("obs"),
    version,
    createdAt: new Date().toISOString(),
    contentHash: p.contentHash,
  };
  const encoded = JSON.stringify(s);
  db.prepare("INSERT INTO research.observation_snapshots VALUES (?,?,?,?,?,?,?)").run(
    s.id,
    s.name,
    version,
    s.createdAt,
    s.contentHash,
    hashOf(encoded),
    encoded,
  );
  return { ok: true, snapshot: s };
}
export function getObservations(db, id) {
  ensure(db);
  const read = (id) =>
    decode(db.prepare("SELECT body,body_hash FROM research.observation_snapshots WHERE id=?").get(id));
  const snapshot = read(id);
  verifyObservationComposition(snapshot, read);
  return snapshot;
}
export function listObservations(db) {
  ensure(db);
  return db
    .prepare("SELECT body,body_hash FROM research.observation_snapshots ORDER BY created_at DESC,id DESC LIMIT 200")
    .all()
    .map((row) => {
      const s = decode(row);
      return {
        id: s.id,
        name: s.name,
        version: s.version,
        createdAt: s.createdAt,
        contentHash: s.contentHash,
        coverage: s.coverage,
      };
    });
}
export function deriveObservationSignals(db, id, body) {
  const snapshot = getObservations(db, id),
    name = text(body?.name, "Derived dataset name", 120);
  const metric = text(body.metric, "Metric", 100),
    unit = text(body.unit, "Unit", 60),
    op = body.operator,
    threshold = body.threshold;
  const comparisons = { gt: (a, b) => a > b, gte: (a, b) => a >= b, lt: (a, b) => a < b, lte: (a, b) => a <= b };
  if (!Object.hasOwn(comparisons, op) || typeof threshold !== "number" || !Number.isFinite(threshold))
    throw Error("Choose gt, gte, lt or lte and a finite numeric threshold.");
  if (!["buy", "sell"].includes(body.side)) throw Error("Choose buy or sell explicitly.");
  const bindings = body.bindings;
  if (!bindings || typeof bindings !== "object" || Array.isArray(bindings))
    throw Error("Provide explicit entity-to-symbol bindings.");
  if (body.revisionPolicy != null && body.revisionPolicy !== "first-publication")
    throw Error("Historical signals require the first-publication revision policy.");
  const resolution = resolveObservations(snapshot, {
    mode: "first-publication",
    ...(body.knownAt !== undefined ? { knownAt: body.knownAt } : {}),
  });
  const observationType = body.observationType ?? "realized";
  if (!["realized", "forecast"].includes(observationType)) throw Error("Choose realized or forecast observations.");
  if (snapshot.events.some((e) => e.observationType === "forecast") && !body.observationType)
    throw Error("Explicitly choose realized or forecast observations for this history.");
  const relevant = resolution.items.filter(
    (e) => (e.observationType || "realized") === observationType && e.metric === metric && e.unit === unit,
  );
  const forecastExclusions = relevant
    .filter((e) => !forecastKnownBeforeTarget(e))
    .map((e) => ({ id: e.id, reason: "first-publication-not-before-target" }));
  const selected = relevant.filter((e) => forecastKnownBeforeTarget(e) && comparisons[op](e.value, threshold));
  if (!selected.length)
    throw Error(
      "No observations satisfy this exact type, metric, unit and threshold with eligible publication timing.",
    );
  const signals = [],
    lineage = [];
  for (const e of selected) {
    const symbols = Object.hasOwn(bindings, e.entityId) ? bindings[e.entityId] : null;
    if (
      !Array.isArray(symbols) ||
      !symbols.length ||
      symbols.length > 100 ||
      symbols.some((s) => typeof s !== "string" || s !== s.trim().toUpperCase()) ||
      new Set(symbols).size !== symbols.length
    )
      throw Error(`Provide distinct exact ticker symbols for ${e.entityId}.`);
    if (signals.length + symbols.length > ROW_LIMIT)
      throw Error("The transformation exceeds 5,000 signals. Narrow the threshold or entity bindings.");
    for (const symbol of symbols) {
      const signalId = hashOf({ observation: e.id, symbol });
      signals.push({
        id: signalId,
        symbol,
        eventAt: e.eventAt,
        availableAt: e.availableAt,
        side: body.side,
        sourceUrl: e.sourceUrl,
      });
      lineage.push({
        signalId,
        observationId: e.id,
        logicalObservationId: e.observationId || e.id,
        entityId: e.entityId,
        symbol,
        ...(e.observationType === "forecast" ? { observationType: "forecast", targetAt: e.targetAt } : {}),
      });
    }
  }
  const policy = {
    version: 3,
    observationType,
    revisionPolicy: "first-publication",
    knownAt: resolution.knownAt,
    metric,
    unit,
    operator: op,
    threshold,
    side: body.side,
    bindings,
  };
  const prepared = prepareDataset(db, {
    name,
    source: snapshot.source,
    format: "json",
    content: JSON.stringify(signals),
  });
  if (!prepared.ok) throw Error(prepared.errors.map((e) => `${e.field}: ${e.message}`).join("; "));
  const payload = {
    ...prepared.payload,
    manifest: {
      observation: {
        snapshot,
        policy,
        resolution,
        lineage,
        forecastExclusions,
        received: snapshot.events.length,
        matchingMetric: relevant.length,
        selected: selected.length,
        signals: signals.length,
      },
    },
    caveats: [
      ...prepared.payload.caveats,
      "Only first publications in the pinned observation history generate signals. Later corrections or retractions do not retroactively erase earlier signals; incomplete revision history is not independently detectable.",
      "Signals come from an explicitly chosen numeric threshold and researcher-supplied entity-to-ticker bindings; the mapping is not a verified economic exposure.",
    ],
  };
  return {
    ok: true,
    dataset: putDataset(
      db,
      name,
      payload,
      hashOf({ prepared: prepared.contentHash, snapshotId: snapshot.id, snapshot: snapshot.contentHash, policy }),
    ),
    transformation: payload.manifest.observation,
  };
}

/** Resolve publication vintages inside one explicitly pinned history, never by import order. */
export function resolveObservations(snapshot, { knownAt, mode = "latest-known" } = {}) {
  if (!["latest-known", "first-publication"].includes(mode)) throw Error("Choose latest-known or first-publication.");
  if (mode === "latest-known" && !knownAt) throw Error("A knowledge cutoff is required for latest-known observations.");
  const cutoff = knownAt == null ? null : timestamp(knownAt);
  if (knownAt != null && !cutoff) throw Error("knownAt requires a UTC ISO timestamp or date.");
  const millis = (parsed) => Date.parse(parsed.value) + (parsed.precision === "day" ? 86400000 - 1 : 0);
  const limit = cutoff ? millis(cutoff) : Infinity,
    groups = new Map(),
    decisions = [],
    items = [];
  for (const row of snapshot.events) {
    const publication = timestamp(row.availableAt);
    if (!publication) throw Error("Observation publication timestamp is invalid.");
    const key = row.observationId || row.id,
      at = millis(publication);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ row, at });
  }
  for (const [observationId, rows] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const eligible = rows.filter((r) => r.at <= limit),
      future = rows
        .filter((r) => r.at > limit)
        .map((r) => r.row.id)
        .sort();
    if (!eligible.length) {
      decisions.push({ observationId, reason: "not-yet-known", assertionIds: [], futureAssertionIds: future });
      continue;
    }
    const chosen =
      mode === "first-publication" ? Math.min(...eligible.map((r) => r.at)) : Math.max(...eligible.map((r) => r.at));
    const candidates = eligible.filter((r) => r.at === chosen).sort((a, b) => a.row.id.localeCompare(b.row.id));
    const selected = candidates[0].row;
    const reason =
      candidates.length > 1 ? "ambiguous-publication" : selected.status === "retracted" ? "retracted" : "selected";
    if (reason === "selected") items.push(selected);
    decisions.push({
      observationId,
      reason,
      assertionIds: candidates.map((r) => r.row.id),
      otherKnownAssertionIds: eligible
        .filter((r) => r.at !== chosen)
        .map((r) => r.row.id)
        .sort(),
      futureAssertionIds: future,
    });
  }
  return {
    version: 1,
    snapshotId: snapshot.id || null,
    contentHash: snapshot.contentHash || null,
    mode,
    knownAt: cutoff?.value || null,
    items,
    decisions,
    coverage: {
      assertions: snapshot.events.length,
      observations: groups.size,
      selected: items.length,
      ambiguous: decisions.filter((d) => d.reason === "ambiguous-publication").length,
      retracted: decisions.filter((d) => d.reason === "retracted").length,
      notYetKnown: decisions.filter((d) => d.reason === "not-yet-known").length,
    },
    caveats: [
      "History is limited to the explicitly pinned snapshot; missing earlier revisions are not detectable.",
      "Date-only availability and date-only cutoffs mean the end of the UTC day.",
      "Latest-known lookup is for dated evidence inspection; historical signals use first publications to avoid hindsight selection.",
    ],
  };
}

/** Recompute the revision decision from the frozen source; never trust a saved audit alone. */
export function verifyObservationDerivation(dataset) {
  const m = dataset.manifest?.observation;
  if (!m) return;
  verifyObservationComposition(m.snapshot);
  if (m.policy.version === 1) return;
  const p = m.policy;
  if (![2, 3].includes(p.version) || p.revisionPolicy !== "first-publication")
    throw Error("Unsupported observation revision policy.");
  if (p.version === 3 && !["realized", "forecast"].includes(p.observationType))
    throw Error("Invalid observation type in policy.");
  if (p.version === 2 && m.snapshot.events.some((e) => e.observationType === "forecast"))
    throw Error("Forecast signals require policy version 3.");
  const resolved = resolveObservations(m.snapshot, {
    mode: "first-publication",
    ...(p.knownAt !== null ? { knownAt: p.knownAt } : {}),
  });
  if (hashOf(resolved) !== hashOf(m.resolution)) throw Error("Observation revision resolution mismatch.");
  const compare = { lt: (a, b) => a < b, lte: (a, b) => a <= b, gt: (a, b) => a > b, gte: (a, b) => a >= b };
  if (!Object.hasOwn(compare, p.operator) || !Number.isFinite(p.threshold))
    throw Error("Invalid observation threshold.");
  const relevant = resolved.items.filter(
    (e) =>
      (p.version === 2 || (e.observationType || "realized") === p.observationType) &&
      e.metric === p.metric &&
      e.unit === p.unit,
  );
  const selected = relevant.filter(
    (e) => (p.version === 2 || forecastKnownBeforeTarget(e)) && compare[p.operator](e.value, p.threshold),
  );
  if (
    p.version === 3 &&
    hashOf(m.forecastExclusions) !==
      hashOf(
        relevant
          .filter((e) => !forecastKnownBeforeTarget(e))
          .map((e) => ({ id: e.id, reason: "first-publication-not-before-target" })),
      )
  )
    throw Error("Forecast timing exclusions mismatch.");
  const expected = [],
    lineage = [];
  for (const e of selected) {
    const symbols = p.bindings[e.entityId];
    if (!Array.isArray(symbols)) throw Error("Missing observation binding.");
    for (const symbol of symbols) {
      const id = hashOf({ observation: e.id, symbol });
      expected.push({
        id,
        symbol,
        eventAt: e.eventAt,
        availableAt: e.availableAt,
        side: p.side,
        sourceUrl: e.sourceUrl,
        value: null,
      });
      lineage.push({
        signalId: id,
        observationId: e.id,
        logicalObservationId: e.observationId || e.id,
        entityId: e.entityId,
        symbol,
        ...(e.observationType === "forecast" ? { observationType: "forecast", targetAt: e.targetAt } : {}),
      });
    }
  }
  const actual = dataset.events.map((e) => ({
    id: e.id,
    symbol: e.entity.symbol,
    eventAt: e.eventAt,
    availableAt: e.availableAt,
    side: e.side,
    sourceUrl: e.sourceUrl,
    value: e.value,
  }));
  if (
    hashOf(expected) !== hashOf(actual) ||
    hashOf(lineage) !== hashOf(m.lineage) ||
    m.received !== m.snapshot.events.length ||
    m.matchingMetric !== relevant.length ||
    m.selected !== selected.length ||
    m.signals !== expected.length
  )
    throw Error("Observation derived signals or lineage mismatch.");
}

const assertionFields = [
  "id",
  "observationId",
  "status",
  "entityId",
  "metric",
  "unit",
  "value",
  "eventAt",
  "availableAt",
  "sourceUrl",
];
function normalizedAssertion(row) {
  return {
    ...Object.fromEntries(
      assertionFields.map((key) => [
        key,
        key === "observationId" ? row.observationId || row.id : key === "status" ? row.status || "asserted" : row[key],
      ]),
    ),
    ...(row.observationType === "forecast" ? { observationType: "forecast", targetAt: row.targetAt } : {}),
  };
}
function combinedRows(sources) {
  const records = new Map();
  for (const source of sources)
    for (const row of source.events) {
      const normalized = normalizedAssertion(row),
        prior = records.get(row.id);
      if (prior && hashOf(prior.row) !== hashOf(normalized))
        throw Error(
          `Publication ID ${row.id} has conflicting contents. Give each revision a distinct publication ID before merging.`,
        );
      if (prior) prior.sourceSnapshotIds.push(source.id);
      else records.set(row.id, { row: normalized, sourceSnapshotIds: [source.id] });
      if (records.size > ROW_LIMIT) throw Error("Merged history exceeds 5,000 publication records.");
    }
  return [...records]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, r]) => ({ ...r.row, mergeSourceSnapshotIds: r.sourceSnapshotIds.sort() }));
}
export function mergeObservationSnapshots(db, body) {
  const name = text(body?.name, "Merged history name", 120),
    reason = text(body.reason, "Merge reason", 2000),
    identityNamespace = text(body.identityNamespace, "Shared observation ID namespace", 300);
  const ids = body.snapshotIds;
  if (
    !Array.isArray(ids) ||
    ids.length < 2 ||
    ids.length > 20 ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => typeof id !== "string")
  )
    throw Error("Select 2–20 distinct observation snapshots.");
  const sources = [...ids].sort().map((id) => getObservations(db, id));
  const first = sources[0];
  for (const s of sources)
    if (s.source !== first.source || s.ownership !== first.ownership || s.license !== first.license)
      throw Error(
        "Merged histories require matching source, ownership and license labels. Import compatible data explicitly; rights are never combined by guess.",
      );
  const items = combinedRows(sources),
    merge = { version: 1, reason, identityNamespace, sources };
  const p = prepareObservations({
    name,
    source: first.source,
    ownership: first.ownership,
    license: first.license,
    format: "json",
    content: JSON.stringify({ items, merge }),
  });
  if (!p.ok) throw Error(p.errors.map((e) => `Row ${e.row} ${e.field}: ${e.message}`).join("; "));
  p.payload.composition = {
    version: 1,
    reason,
    identityNamespace,
    sources: sources.map((s) => ({ id: s.id, contentHash: s.contentHash, snapshotHash: hashOf(s) })),
    received: sources.reduce((n, s) => n + s.events.length, 0),
    unique: items.length,
  };
  p.payload.caveats.push(
    "This history explicitly combines selected snapshots. Shared IDs are a researcher assertion; omitted histories are not inferred. Exact repeated publications are deduplicated; conflicting publication IDs are refused.",
  );
  verifyObservationComposition(p.payload, (id) => sources.find((s) => s.id === id));
  return savePreparedObservations(db, p);
}

/** Reconstruct a merged history from embedded immutable source snapshots and check database references when supplied. */
export function verifyObservationComposition(snapshot, lookup) {
  verifyObservationSource(snapshot);
  if (!snapshot.composition) return;
  const c = snapshot.composition,
    raw = JSON.parse(snapshot.rawContent),
    merge = raw.merge;
  if (
    c.version !== 1 ||
    merge?.version !== 1 ||
    !Array.isArray(merge.sources) ||
    merge.sources.length < 2 ||
    merge.sources.length > 20
  )
    throw Error("Invalid observation history composition.");
  const refs = merge.sources.map((s) => ({ id: s.id, contentHash: s.contentHash, snapshotHash: hashOf(s) }));
  if (
    new Set(refs.map((r) => r.id)).size !== refs.length ||
    hashOf(refs) !== hashOf(c.sources) ||
    merge.reason !== c.reason ||
    merge.identityNamespace !== c.identityNamespace
  )
    throw Error("Observation history source manifest mismatch.");
  for (const s of merge.sources) {
    verifyObservationSource(s);
    if (s.source !== snapshot.source || s.ownership !== snapshot.ownership || s.license !== snapshot.license)
      throw Error("Observation history source labels mismatch.");
    if (
      hashOf(s.rawContent) !== s.rawHash ||
      hashOf({
        raw: s.rawContent,
        mapping: s.mapping,
        source: s.source,
        ownership: s.ownership,
        license: s.license,
      }) !== s.contentHash
    )
      throw Error("Observation history source checksum mismatch.");
    if (lookup && hashOf(lookup(s.id)) !== hashOf(s))
      throw Error("Observation history source differs from its saved snapshot.");
  }
  const rows = combinedRows(merge.sources);
  if (
    hashOf(rows) !== hashOf(raw.items) ||
    hashOf(rows.map(normalizedAssertion)) !== hashOf(snapshot.events.map(normalizedAssertion)) ||
    c.received !== merge.sources.reduce((n, s) => n + s.events.length, 0) ||
    c.unique !== rows.length
  )
    throw Error("Observation history combined records mismatch.");
}

/** Schema 3 keeps forecast semantics tied to the original importer assertions. */
function verifyObservationSource(snapshot) {
  if (snapshot.schemaVersion !== 3) return;
  const checked = prepareObservations(
    { ...snapshot, content: snapshot.rawContent },
    { now: snapshot.createdAt || new Date().toISOString() },
  );
  if (
    !checked.ok ||
    hashOf(checked.payload.events) !== hashOf(snapshot.events) ||
    hashOf(checked.payload.coverage) !== hashOf(snapshot.coverage)
  )
    throw Error("Observation normalized records differ from their original source.");
}
