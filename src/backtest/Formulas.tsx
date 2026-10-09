import { useEffect, useState } from "react";
import type { Formula } from "../../shared/formulas.mjs";

type Render = (tex: string) => string;
let loading: Promise<Render> | null = null;

/** KaTeX is loaded the first time a formula is shown, and renders to MathML (no font or CSS download). */
function loadKatex(): Promise<Render> {
  loading ||= import("katex").then((m) => (tex: string) => m.default.renderToString(tex, { output: "mathml", throwOnError: false, displayMode: false }));
  return loading;
}

function Tex({ tex, render }: { tex: string; render: Render | null }) {
  if (!tex) return null;
  if (!render) return <code className="fx-raw">{tex}</code>;
  return <span className="fx-math" dangerouslySetInnerHTML={{ __html: render(tex) }} />;
}

/** Every metric with its formula and the same formula with this run's numbers in it. */
export function Formulas({ formulas, open = false }: { formulas: Formula[]; open?: boolean }) {
  const [render, setRender] = useState<Render | null>(null);
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (!shown || render) return;
    let live = true;
    loadKatex().then((r) => { if (live) setRender(() => r); }).catch(() => null);
    return () => { live = false; };
  }, [shown, render]);
  if (!formulas.length) return null;
  return (
    <details className="fx" open={open} onToggle={(e) => setShown((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>How each number is computed <small>{formulas.length} formulas, worked with this run's figures</small></summary>
      {shown ? (
        <dl>
          {formulas.map((f) => (
            <div key={f.id} className="fx-row">
              <dt>{f.title}</dt>
              <dd>
                <div className="fx-line"><Tex tex={f.tex} render={render} /></div>
                {f.worked ? <div className="fx-line fx-worked"><em>this run</em><Tex tex={f.worked} render={render} /></div> : null}
                {f.note ? <p className="fx-note">{f.note}</p> : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </details>
  );
}
