import { useState, type CSSProperties } from "react";
import "./tokens.css";
import "./materials.css";
import "./preview.css";

const cores = ["midnight", "atlas", "ivory", "stone", "slate", "brass"];
const chroma = ["blue", "amber", "crimson", "violet", "cyan", "lime", "orange", "pink"];
const presets = ["sage", "ivory", "blue", "crimson", "violet"];
const variants = ["base", "light", "dark", "muted", "alpha"];
const tone = (name: string) => ({ background: `var(--tsi-${name})` });
function Geometry() {
  return (
    <svg className="material-geometry" viewBox="0 0 600 250" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth=".7">
        <circle cx="465" cy="125" r="108" />
        <circle cx="465" cy="125" r="90" />
        <path d="M340 125h250M465 0v250M465 125L595 30M465 125L600 73M465 125L600 173M465 125L590 220" />
      </g>
      <path d="M465 125L600 78V102Z M465 125L600 155V177Z" fill="currentColor" opacity=".18" />
    </svg>
  );
}
function Specimen({ title, treatment }: { title: string; treatment: string }) {
  return (
    <figure className="material-specimen">
      <figcaption>{title}</figcaption>
      <div className={`tsi-material ${treatment} material-plate`}>
        <Geometry />
        <div className="tsi-material-content material-caption">
          <h3>Geography meets evidence.</h3>
          <p>A background study for research introductions.</p>
        </div>
      </div>
      <div className="material-data">
        <span>Illustrative content · not a live report</span>
        <dl>
          <div>
            <dt>Surface</dt>
            <dd>Research overview</dd>
          </div>
          <div>
            <dt>Information layer</dt>
            <dd>Untextured</dd>
          </div>
        </dl>
      </div>
    </figure>
  );
}
export function MaterialSheet() {
  const [preset, setPreset] = useState("sage");
  const [effect, setEffect] = useState("sandy");
  const [grain, setGrain] = useState(true);
  const [intensity, setIntensity] = useState(18);
  const [enabled, setEnabled] = useState(true);
  const treatment = enabled
    ? `tsi-material--${effect} ${grain && effect === "sandy" ? "tsi-material--grain" : ""} tsi-sand--${preset}`
    : "";
  return (
    <main className="tsi-theme material-sheet" style={{ "--tsi-grain-opacity": intensity / 100 } as CSSProperties}>
      <header className="material-head">
        <a href="#week">← Back to terminal</a>
        <span>Development only · Phase A</span>
      </header>
      <div className="material-intro">
        <h1>Color &amp; material.</h1>
        <p>
          Midnight green, measured color, and the quiet texture of print. An isolated study; the terminal’s existing
          theme and data colors remain unchanged.
        </p>
      </div>
      <section aria-labelledby="comparison-title">
        <div className="material-section-title">
          <h2 id="comparison-title">Surface comparison</h2>
          <span>Identical content · independent treatment</span>
        </div>
        <form className="material-controls" onSubmit={(e) => e.preventDefault()}>
          <label>
            Material
            <select value={effect} onChange={(e) => setEffect(e.target.value)}>
              <option value="sandy">Sandy gradient</option>
              <option value="grain">Film grain</option>
              <option value="halftone">Halftone</option>
              <option value="archive">Archival wear</option>
            </select>
          </label>
          <label>
            Gradient
            <select value={preset} disabled={effect !== "sandy"} onChange={(e) => setPreset(e.target.value)}>
              {presets.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="material-check">
            <input
              type="checkbox"
              checked={grain}
              disabled={effect !== "sandy"}
              onChange={(e) => setGrain(e.target.checked)}
            />
            Grain in gradient
          </label>
          <label>
            Grain intensity · {intensity}%
            <input
              type="range"
              min="0"
              max="24"
              value={intensity}
              disabled={!enabled || !((effect === "sandy" && grain) || effect === "grain")}
              onChange={(e) => setIntensity(Number(e.target.value))}
            />
          </label>
          <label className="material-check">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Treatment enabled
          </label>
        </form>
        <div className="material-comparison">
          <Specimen title="Flat reference" treatment="" />
          <Specimen
            title={enabled ? `${effect} · ${effect === "sandy" ? preset : "static texture"}` : "Treatment disabled"}
            treatment={treatment}
          />
        </div>
      </section>
      <section aria-labelledby="core-title">
        <div className="material-section-title">
          <h2 id="core-title">Core palette</h2>
          <span>Foundation, not a global replacement</span>
        </div>
        <div className="material-core">
          {cores.map((c) => (
            <div key={c}>
              <div className="material-swatch" style={tone(`core-${c}`)} />
              <span>{c}</span>
              <code>--tsi-core-{c}</code>
            </div>
          ))}
        </div>
      </section>
      <section aria-labelledby="chroma-title">
        <div className="material-section-title">
          <h2 id="chroma-title">Chromatic range</h2>
          <span>Base / light / dark / muted / 16% alpha</span>
        </div>
        <p>
          These are available colors, not new category assignments. Use light variants for small text; dark and muted
          variants are surface colors.
        </p>
        <div className="material-chroma">
          {chroma.map((c) => (
            <div key={c} className="material-chroma-row">
              <span>{c}</span>
              <div>
                {variants.map((v) => (
                  <div
                    key={v}
                    className="material-swatch"
                    title={`${c} · ${v}`}
                    aria-label={`${c} ${v}`}
                    style={tone(`chroma-${c}${v === "base" ? "" : `-${v}`}`)}
                  />
                ))}
              </div>
              <code>--tsi-chroma-{c}</code>
            </div>
          ))}
        </div>
      </section>
      <section aria-labelledby="presets-title">
        <div className="material-section-title">
          <h2 id="presets-title">Pigment studies</h2>
          <span>Five directional transitions</span>
        </div>
        <div className="material-studies">
          {presets.map((p) => (
            <figure key={p}>
              <div
                className={`tsi-material tsi-material--sandy tsi-material--grain tsi-sand--${p}`}
                aria-label={`${p} sandy gradient`}
              />
              <figcaption>Midnight → {p}</figcaption>
            </figure>
          ))}
        </div>
      </section>
      <section className="material-rules" aria-labelledby="rules-title">
        <h2 id="rules-title">Atmosphere around the evidence.</h2>
        <p>
          Use material on introductions, empty-state framing, and editorial plates. Keep tables, prices, citations,
          controls, map labels, and chart marks clean. Never change a semantic color simply to use a new swatch.
        </p>
        <p>
          No animation. No full-screen filters. Stable texture assets behind the content. Review this foundation before
          applying a production pilot.
        </p>
      </section>
      <footer>
        TradeSimple Intel · Material foundation · <a href="#week">Return to research</a>
      </footer>
    </main>
  );
}
