/** Legend for the S&P 500 HQ layer: districts shaded by how many index headquarters they hold. */
export function HqLegend({ top, source }: { top: { code: string; n: number }[]; source: string }) {
  return (
    <div className="legend vote-legend">
      <span><i className="swatch" style={{ background: "#2c4f60" }} />1 HQ</span>
      <span><i className="swatch" style={{ background: "#3f7287" }} />2–4</span>
      <span><i className="swatch" style={{ background: "#5f9bb0" }} />5+</span>
      <span>Top {top.map((t) => `${t.code} ${t.n}`).join(" · ")}</span>
      <small>{source}</small>
    </div>
  );
}
