import { useState } from "react";
import { AUTO, modelShort, nudgeToAuto } from "../../shared/modelRoute.mjs";
import type { AskApi } from "./useAsk";
import "./meta.css";

const NUDGE_KEY = "intel:ask:autoNudge:v1";
const nudged = () => { try { return localStorage.getItem(NUDGE_KEY) === "1"; } catch { return true; } };
const markNudged = () => { try { localStorage.setItem(NUDGE_KEY, "1"); } catch { /* shown again next time */ } };

/**
 * The model picker. "Auto (recommended)" is the default: simple lookups use the server's model, heavy work the strong
 * one. A pinned model is never overridden; a saved small model gets a one-time offer to switch to Auto.
 */
export function ModelPick({ ask, busy }: { ask: AskApi; busy: boolean }) {
  const [seen, setSeen] = useState(nudged);
  if (!ask.models.length) return null;
  const strong = ask.status?.strong || "";
  const nudge = !seen && nudgeToAuto(ask.model);
  const done = (auto: boolean) => {
    markNudged();
    setSeen(true);
    if (auto) ask.chooseModel(AUTO);
  };
  return (
    <>
      <label className="ask-pick ask-model">
        Model
        <select aria-label="Model" value={ask.model} disabled={busy} onChange={(e) => ask.chooseModel(e.target.value)}>
          <option value={AUTO}>Auto (recommended){strong ? ` · ${modelShort(strong)} for heavy work` : ""}</option>
          {ask.models.map((m) => <option key={m.id} value={m.id}>{m.id}{m.id === ask.status?.model ? " · default" : ""}{m.small ? " · small" : ""}</option>)}
        </select>
      </label>
      {nudge ? (
        <p className="ask-nudge" role="status">
          {modelShort(ask.model)} is a small model and may skip tools or figures. Auto keeps it off backtests, web research, and figure checks.
          <button type="button" className="link" onClick={() => done(true)}>Switch to Auto</button>
          <button type="button" className="link" onClick={() => done(false)}>Keep {modelShort(ask.model)}</button>
        </p>
      ) : null}
    </>
  );
}
