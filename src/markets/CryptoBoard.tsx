import { useEffect, useMemo, useState } from "react";
import { api, when } from "../lib/api";
import { quoteStale } from "../lib/fresh";
import { big, num, signed, tone, usd } from "./format";
import { Spark } from "./Spark";

type Coin = {
  symbol: string;
  code: string;
  name: string;
  digits: number;
  last: number | null;
  change: number | null;
  changePct: number | null;
  high: number | null;
  low: number | null;
  yearHigh: number | null;
  yearLow: number | null;
  spark?: number[];
  asOf: string;
  rank?: number | null;
  marketCap?: number | null;
  volume24h?: number | null;
  change24h?: number | null;
  change7d?: number | null;
  change30d?: number | null;
  supply?: number | null;
  maxSupply?: number | null;
  ath?: number | null;
  athDate?: string | null;
  fromAth?: number | null;
};

type CryptoPayload = {
  ok: boolean;
  error?: string;
  source?: string;
  asOf?: string;
  latency?: string;
  global?: { marketCap: number; volume: number; btcDominance: number; ethDominance: number; change24h: number; coins: number } | null;
  items: Coin[];
};

type SortKey = "rank" | "change24h" | "change7d" | "change30d" | "volume24h" | "fromAth";

const COLS: { key: SortKey; label: string }[] = [
  { key: "change24h", label: "24h" },
  { key: "change7d", label: "7d" },
  { key: "change30d", label: "30d" }
];

export function CryptoBoard({ onOpen }: { onOpen: (symbol: string) => void }) {
  const [board, setBoard] = useState<CryptoPayload | null>(null);
  const [error, setError] = useState("");
  const [sort, setSort] = useState<SortKey>("rank");

  useEffect(() => {
    let cancel = false;
    const load = () => api<CryptoPayload>("/api/crypto/board")
      .then((res) => {
        if (cancel) return;
        if (!res.ok) setError(res.error || "No coins");
        else {
          setError("");
          setBoard(res);
        }
      })
      .catch((err: Error) => { if (!cancel) setError(err.message); });
    load();
    const timer = window.setInterval(load, 120000);
    return () => {
      cancel = true;
      window.clearInterval(timer);
    };
  }, []);

  const items = useMemo(() => {
    const list = [...(board?.items || [])];
    if (sort === "rank") return list.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
    return list.sort((a, b) => (b[sort] ?? -Infinity) - (a[sort] ?? -Infinity));
  }, [board, sort]);
  const g = board?.global;

  const header = (key: SortKey, label: string) => (
    <th className={sort === key ? "sorted" : ""}>
      <button onClick={() => setSort(sort === key ? "rank" : key)}>{label}</button>
    </th>
  );

  return (
    <div className="board crypto positions">
      <header className="board-head">
        <div>
          <strong>CRYPTO</strong>
          <span>{items.length ? `${items.length} assets by market cap` : "Loading coins"}</span>
        </div>
        <p>
          <em>SOURCE</em> {board?.source || "Yahoo Finance · CoinGecko"}
          <em>AS OF</em> {when(board?.asOf)}
          <em>NOTE</em> {board?.latency || "Crypto trades 24/7."}
        </p>
      </header>
      {g ? (
        <dl className="tape-stats macro-strip">
          <div><dt>Total mkt cap</dt><dd>{usd(g.marketCap)}</dd><small className={tone(g.change24h)}>{signed(g.change24h, 2, "% 24h")}</small></div>
          <div><dt>24h volume</dt><dd>{usd(g.volume)}</dd><small> </small></div>
          <div><dt>BTC dominance</dt><dd>{num(g.btcDominance, 1)}%</dd><small> </small></div>
          <div><dt>ETH dominance</dt><dd>{num(g.ethDominance, 1)}%</dd><small> </small></div>
          <div><dt>Tracked coins</dt><dd>{g.coins.toLocaleString("en-US")}</dd><small>CoinGecko</small></div>
        </dl>
      ) : null}
      {error ? <p className="tape-empty">{error}</p> : null}
      <div className="board-scroll">
        <table>
          <thead>
            <tr>
              {header("rank", "#")}
              <th>Name</th>
              <th>Last</th>
              <th>Day %</th>
              {COLS.map((c) => header(c.key, c.label))}
              <th>Mkt cap</th>
              {header("volume24h", "Vol 24h")}
              <th>Supply</th>
              <th>Max</th>
              <th>ATH</th>
              {header("fromAth", "From ATH")}
              <th>5d</th>
            </tr>
          </thead>
          <tbody>
            {items.map((coin) => (
              <tr key={coin.symbol} onClick={() => onOpen(coin.symbol)}>
                <td>
                  {coin.rank ?? "—"} {coin.code}
                  {quoteStale(coin.asOf) ? <small className="stale"> stale</small> : null}
                </td>
                <td className="board-name">{coin.name}</td>
                <td>{num(coin.last, coin.digits)}</td>
                <td className={tone(coin.changePct)}>{signed(coin.changePct, 2, "%")}</td>
                <td className={tone(coin.change24h)}>{signed(coin.change24h, 2, "%")}</td>
                <td className={tone(coin.change7d)}>{signed(coin.change7d, 2, "%")}</td>
                <td className={tone(coin.change30d)}>{signed(coin.change30d, 2, "%")}</td>
                <td>{usd(coin.marketCap)}</td>
                <td>{usd(coin.volume24h)}</td>
                <td>{big(coin.supply)}</td>
                <td>{coin.maxSupply ? big(coin.maxSupply) : "∞"}</td>
                <td title={coin.athDate || ""}>{num(coin.ath, coin.digits)}</td>
                <td className={tone(coin.fromAth)}>{signed(coin.fromAth, 1, "%")}</td>
                <td><Spark values={coin.spark} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
