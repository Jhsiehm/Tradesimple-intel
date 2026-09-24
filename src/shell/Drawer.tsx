import type { DrawerModel } from "../types";

export function Drawer({ model, onClose }: { model: DrawerModel; onClose: () => void }) {
  return (
    <aside className="drawer" role="dialog" aria-label={model.title}>
      <div className="drawer-bar">
        <span>DOSSIER</span>
        <button className="ghost" onClick={onClose}>Close</button>
      </div>
      <div className="drawer-body">
        <h2>{model.title}</h2>
        {model.meta ? <p className="meta">{model.meta}</p> : null}
        {model.stages ? (
          <ol className="ladder">
            {model.stages.map((stage) => (
              <li key={stage.name} className={stage.reached ? "reached" : undefined}>
                {stage.name}
              </li>
            ))}
          </ol>
        ) : null}
        <dl className="kv">
          {model.rows.map((row) => (
            <span key={row.label} style={{ display: "contents" }}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </span>
          ))}
        </dl>
        {model.blocks?.map((block) => (
          <section key={block.title} className="block">
            <h3>{block.title}</h3>
            {block.lines.length ? block.lines.map((line) => <p key={line}>{line}</p>) : <p>None on this feed.</p>}
          </section>
        ))}
      </div>
    </aside>
  );
}
