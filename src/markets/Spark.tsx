export function Spark({ values, width = 72, height = 18 }: { values?: (number | null)[]; width?: number; height?: number }) {
  const pts = (values || []).filter((v): v is number => v != null && Number.isFinite(v));
  if (pts.length < 2) return <span className="spark-empty">—</span>;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const path = pts.map((v, i) => `${((i / (pts.length - 1)) * width).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`).join(" ");
  const up = pts[pts.length - 1] >= pts[0];
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={path} fill="none" stroke={up ? "#8fbf6a" : "#e07a72"} strokeWidth="1.2" />
    </svg>
  );
}

export function RangeBar({ low, high, last }: { low?: number | null; high?: number | null; last?: number | null }) {
  if (low == null || high == null || last == null || high <= low) return <span className="spark-empty">—</span>;
  const at = Math.max(0, Math.min(1, (last - low) / (high - low)));
  return (
    <span className="range-bar" title={`52w ${low} – ${high}`}>
      <i style={{ left: `${at * 100}%` }} />
    </span>
  );
}
