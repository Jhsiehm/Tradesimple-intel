/**
 * Yahoo v8 chart body → daily bars [day, open, close], split and dividend adjusted, ascending.
 * `day` is whole days since 1970-01-01 UTC. The open is scaled by the same factor as the close so a
 * gap between adjusted open and adjusted close is the real intraday move.
 */
export function parseBars(body) {
  const result = body?.chart?.result?.[0];
  if (!result) throw new Error(body?.chart?.error?.description || "no chart");
  const stamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const adj = result.indicators?.adjclose?.[0]?.adjclose || [];
  const out = [];
  for (let i = 0; i < stamps.length; i += 1) {
    const rawClose = quote.close?.[i];
    const close = adj[i] ?? rawClose;
    if (close == null || !Number.isFinite(close) || !(close > 0)) continue;
    const rawOpen = quote.open?.[i];
    const factor = rawClose > 0 && adj[i] != null ? adj[i] / rawClose : 1;
    const open = rawOpen != null && Number.isFinite(rawOpen) && rawOpen > 0 ? Number((rawOpen * factor).toPrecision(7)) : null;
    const day = Math.floor(stamps[i] / 86_400);
    const bar = [day, open, Number(close.toPrecision(7))];
    if (out.length && out.at(-1)[0] === day) out[out.length - 1] = bar;
    else out.push(bar);
  }
  return out;
}
