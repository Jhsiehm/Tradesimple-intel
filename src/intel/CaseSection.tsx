import { useState, type ReactNode } from "react";
import { CASE_OPEN_KEY, isOpen, parseOpen, sectionId, withOpen, type OpenState } from "../../shared/caseState.mjs";
import "./case.css";

function readOpen(): OpenState {
  try { return parseOpen(localStorage.getItem(CASE_OPEN_KEY)); } catch { return {}; }
}

/** A dossier section that folds under its small-caps header and remembers that per subject kind and title. */
export function CaseSection({ kind, title, count, children }: { kind?: string; title: string; count?: ReactNode; children: ReactNode }) {
  const [state, setState] = useState(readOpen);
  const id = sectionId(kind, title);
  const open = isOpen(state, id);
  const toggle = () => {
    const next = withOpen(readOpen(), id, !open);
    setState(next);
    try { localStorage.setItem(CASE_OPEN_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  };
  return (
    <section className={open ? "case-sec" : "case-sec shut"}>
      <h3 className="case-sec-h">
        <button aria-expanded={open} onClick={toggle} title={open ? "Fold this section" : "Show this section"}>
          <i aria-hidden="true">{open ? "▾" : "▸"}</i>
          <span>{title}</span>
          {count != null && count !== "" ? <small>{count}</small> : null}
        </button>
      </h3>
      {open ? <div className="case-sec-body">{children}</div> : null}
    </section>
  );
}
