export function Lag({ days, due }: { days?: number | null; due: number }) {
  if (days == null) return <span className="dim">—</span>;
  const tone = days > due * 2 ? "lag-late" : days > due ? "lag-slow" : "lag-ok";
  return <span className={`lag ${tone}`} title={`${days} days from event to public filing`}>{days}d</span>;
}
