/** Standalone structural/checksum verification. Never executes model output or contacts a provider. */
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";
const hash = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
const check = (condition, message) => {
  if (!condition) throw Error(message);
};
function context(s) {
  check(s && Array.isArray(s.records), "Missing memory snapshot.");
  const { mode, scope, knownAt, records } = s;
  check(hash({ mode, scope, knownAt, records }) === s.contentHash, "Memory content checksum mismatch.");
  if (mode === "isolated") check(!records.length, "Isolated context contains memory.");
  for (const r of records) {
    check(r.approval.notebookHash === hash(r.notebook), "Approved notebook checksum mismatch.");
    check(
      r.approval.action === "approve" &&
        r.approval.notebookId === r.notebook.id &&
        r.approval.revision === r.notebook.revision,
      "Approval revision mismatch.",
    );
    check(
      Date.parse(r.approval.createdAt) <= Date.parse(knownAt) &&
        Date.parse(r.notebook.createdAt) <= Date.parse(knownAt),
      "Memory exceeds its cutoff.",
    );
  }
}
function analysis(a) {
  check(a && Array.isArray(a.events) && a.events.length, "Missing analysis journal.");
  let previous = null;
  for (const [i, e] of a.events.entries()) {
    check(e.analysisId === a.id && e.sequence === i && e.previousHash === previous, "Analysis chain mismatch.");
    check(e.kind !== "finished" || i === a.events.length - 1, "Events follow analysis completion.");
    previous = hash(e);
  }
  check(a.headHash === previous && a.events[0].kind === "started", "Analysis head checksum mismatch.");
  const start = a.events[0].data;
  context(start.snapshot);
  check(
    start.memory.snapshotId === start.snapshot.id &&
      start.memory.contentHash === start.snapshot.contentHash &&
      start.memory.mode === start.snapshot.mode,
    "Analysis memory reference mismatch.",
  );
  const end = a.events.at(-1);
  check(a.status === (end.kind === "finished" ? end.data.status : "incomplete"), "Analysis status mismatch.");
}
export function verifyPairedArchive(bundle) {
  check(
    bundle?.schemaVersion === 1 && bundle.payload && bundle.payloadHash === hash(bundle.payload),
    "Archive checksum mismatch.",
  );
  const { protocol: p, sourceAnalysis: source, contexts, execution: run, reviews } = bundle.payload,
    c = p.conditions;
  check(hash(c) === p.conditionsHash && hash(c.evidence) === c.evidenceHash, "Protocol conditions checksum mismatch.");
  analysis(source);
  check(
    source.id === c.evidenceAnalysisId &&
      source.headHash === c.evidenceAnalysisHash &&
      source.status === "completed" &&
      source.events[0].data.memory.mode === "isolated",
    "External evidence source mismatch.",
  );
  for (const item of c.evidence) {
    const e = source.events[item.sequence];
    check(
      e?.kind === "tool_output" && e.data.name !== "research_memory" && e.data.result && e.data.result.ok !== false,
      "Invalid external evidence event.",
    );
    check(
      hash(item) ===
        hash({ sequence: e.sequence, name: e.data.name, args: e.data.args, result: e.data.result, observedAt: e.at }),
      "External evidence payload mismatch.",
    );
  }
  for (const mode of ["isolated", "context-aware"]) {
    const s = contexts[mode];
    context(s);
    check(
      s.mode === mode &&
        s.knownAt === c.knownAt &&
        s.id === (mode === "isolated" ? p.isolatedSnapshotId : c.contextSnapshotId),
      "Protocol context mismatch.",
    );
  }
  check(contexts["context-aware"].contentHash === c.contextHash, "Protocol approved context checksum mismatch.");
  if (run) {
    const x = run.execution;
    check(x.protocolId === p.id && x.conditionsHash === p.conditionsHash, "Execution protocol mismatch.");
    let shared = null;
    for (const mode of ["isolated", "context-aware"]) {
      const a = run.arms[mode];
      analysis(a);
      const start = a.events[0].data;
      check(
        a.id === x.arms[mode] &&
          start.request.pairId === p.id &&
          start.request.conditionsHash === p.conditionsHash &&
          hash(start.snapshot) === hash(contexts[mode]),
        "Paired arm reference mismatch.",
      );
      check(start.model === c.model && start.provider === c.provider, "Paired arm model mismatch.");
      const modelInputs = a.events.filter((e) => e.kind === "model_input");
      check(
        modelInputs.length <= 1 && (a.status !== "completed" || modelInputs.length === 1),
        "Unexpected paired model call count.",
      );
      check(
        !a.events.some((e) => e.kind === "tool_input" || e.kind === "tool_output"),
        "Paired execution contains external tool calls.",
      );
      for (const event of modelInputs) {
        const input = event.data;
        check(
          input.model === c.model &&
            input.provider === c.provider &&
            input.tools.length === 0 &&
            input.settings.noTools === true,
          "Paired model call mismatch.",
        );
        check(
          input.settings.maxTokens === c.execution.maxTokens && input.settings.temperature === c.execution.temperature,
          "Paired model settings mismatch.",
        );
        check(
          input.messages.length === 2 && input.messages[0].role === "system" && input.messages[1].role === "user",
          "Unexpected paired conversation context.",
        );
        const body = JSON.parse(input.messages[1].content);
        check(
          body.question === c.question &&
            hash(body.externalEvidence) === hash(c.evidence.map((e, i) => ({ reference: `E${i + 1}`, ...e }))),
          "Model external evidence differs from protocol.",
        );
        check(
          hash(body.approvedFindings) ===
            hash(
              contexts[mode].records.map((r, i) => ({
                reference: `M${i + 1}`,
                notebook: r.notebook,
                approval: r.approval,
              })),
            ),
          "Model memory differs from protocol.",
        );
        if (shared !== null) check(input.messages[0].content === shared, "Paired system instructions differ.");
        shared = input.messages[0].content;
      }
      if (run.result) {
        const arm = run.result.arms[mode],
          event = a.events.at(-2);
        const { type, ...summary } = event?.data || {};
        check(
          arm.analysisId === a.id && arm.status === a.status && event.kind === "event" && hash(summary) === hash(arm),
          "Result differs from recorded arm.",
        );
        const outputs = a.events.filter((e) => e.kind === "model_output");
        check(
          outputs.length === 1 &&
            outputs[0].data.output
              .filter((e) => e.type === "text")
              .map((e) => e.delta || "")
              .join("") === arm.answer,
          "Answer differs from provider output.",
        );
      }
    }
    if (run.result) {
      check(run.result.protocolId === p.id && run.result.executionId === x.id, "Result execution mismatch.");
      check(
        run.status === run.result.status &&
          run.status ===
            (Object.values(run.result.arms).every((a) => a.status === "completed") ? "completed" : "incomplete"),
        "Paired result status mismatch.",
      );
    } else check(run.status === "incomplete", "Unfinished execution reported as complete.");
  }
  let previousReview = null;
  for (const r of [...reviews].sort((a, b) => a.revision - b.revision)) {
    check(
      run?.status === "completed" &&
        r.protocolId === p.id &&
        r.executionId === run.execution.id &&
        r.resultHash === hash(run.result) &&
        r.conditionsHash === p.conditionsHash,
      "Review result reference mismatch.",
    );
    check(
      r.criteria === p.evaluation &&
        r.hypothesis === p.hypothesis &&
        r.revision === (previousReview?.revision || 0) + 1 &&
        r.previousId === (previousReview?.id || null),
      "Review history mismatch.",
    );
    for (const excerpt of r.excerpts)
      check(
        run.result.arms[excerpt.arm]?.answer.includes(excerpt.quote) &&
          run.result.arms[excerpt.arm].analysisId === excerpt.analysisId,
        "Review excerpt mismatch.",
      );
    previousReview = r;
  }
  return {
    ok: true,
    protocolId: p.id,
    status: run?.status || "not-executed",
    reviews: reviews.length,
    scope:
      "Checksums, frozen inputs, execution/result links and review history. Not a signature, claim-truth check or model regeneration.",
  };
}
export function verifyPairedDirectory(directory) {
  const root = path.resolve(directory),
    read = (name) => readFileSync(path.join(root, name), "utf8");
  const manifest = JSON.parse(read("checksums.json"));
  check(manifest && typeof manifest === "object" && !Array.isArray(manifest), "Invalid paired checksum manifest.");
  for (const name of ["pair.json", "verify.mjs", "README.txt"])
    check(manifest[name], `Missing manifest entry: ${name}`);
  const allowed =
    /^(pair\.json|verify\.mjs|README\.txt|notebooks\/nb_[a-f0-9]+-r[1-9][0-9]*\/(notebook\.json|verify\.mjs|README\.txt|checksums\.json|runs\/run_[a-f0-9]+\/(run\.json|evidence\.json|trials\.json|checksums\.json|replay\.mjs|README\.txt|engine\/[A-Za-z0-9_-]+\.mjs)))$/;
  for (const [name, digest] of Object.entries(manifest)) {
    check(allowed.test(name), "Unsafe paired archive path.");
    check(hash(read(name)) === digest, `Checksum mismatch: ${name}`);
  }
  const bundle = JSON.parse(read("pair.json")),
    proof = verifyPairedArchive(bundle),
    notebooks = new Map();
  for (const context of Object.values(bundle.payload.contexts))
    for (const { notebook } of context.records) {
      check(
        /^nb_[a-f0-9]+$/.test(notebook.id) && Number.isSafeInteger(notebook.revision) && notebook.revision > 0,
        "Invalid paired notebook identity.",
      );
      const key = `${notebook.id}-r${notebook.revision}`,
        folder = `notebooks/${key}`;
      for (const name of ["notebook.json", "checksums.json", "verify.mjs"])
        check(manifest[`${folder}/${name}`], "Missing paired notebook evidence files.");
      const saved = JSON.parse(read(`${folder}/notebook.json`));
      check(
        saved.notebookHash === hash(notebook) && hash(saved.notebook) === hash(notebook),
        "Paired notebook differs from frozen memory.",
      );
      notebooks.set(key, notebook);
    }
  const results = [];
  for (const [key, note] of notebooks) {
    const verification = spawnSync(process.execPath, ["verify.mjs"], {
      cwd: path.join(root, "notebooks", key),
      encoding: "utf8",
      timeout: 300000,
      maxBuffer: 2 * 1024 * 1024,
    });
    check(
      !verification.error && verification.status === 0,
      `Notebook evidence verification failed: ${key}: ${verification.error?.message || verification.stderr || verification.stdout}`,
    );
    let result;
    try {
      result = JSON.parse(verification.stdout);
    } catch {
      throw Error(`Invalid notebook verification output: ${key}`);
    }
    check(
      result.verified === true && result.notebookId === note.id && result.revision === note.revision,
      "Notebook verification identity mismatch.",
    );
    results.push(result);
  }
  return {
    ...proof,
    notebooks: results,
    scope:
      "Paired inputs, execution/result links, reviews, exact approved notebook revisions and replayable pinned calculations. Not a signature, claim-truth check or model regeneration.",
  };
}
if (process.argv[1] && realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const file = process.argv[2] ? path.resolve(process.argv[2]) : fileURLToPath(new URL("pair.json", import.meta.url));
    console.log(JSON.stringify(verifyPairedDirectory(path.dirname(file)), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
