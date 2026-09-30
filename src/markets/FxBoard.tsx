import { Fragment, useEffect, useState } from "react";
import { api, when } from "../lib/api";
import { quoteStale } from "../lib/fresh";
import { num, signed, tone } from "./format";
import { RangeBar, Spark } from "./Spark";

export type FxItem = {
  symbol: string;
  code: string;
  name: string;
  group: "Index" | "G10" | "EM" | "Cross";
  base: string;
  quote: string;
  digits: number;
  last: number | null;
  change: number | null;
  changePct: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  yearHigh: number | null;
  yearLow: number | null;
  spark?: number[];
  asOf: string;
};

type FxPayload = {
  ok: boolean;
  error?: string;
  source?: string;
  asOf?: string;
  latency?: string;
  items: FxItem[];
  matrix?: { ccys: string[]; rows: { ccy: string; cells: (number | null)[] }[] };
};

export type StripItem = { id: string; label: string; value: string; asOf?: string };
export type Strip = { ok: boolean; source?: string; asOf?: string; latency?: string; items: StripItem[] };

export type EconEvent = {
  id: string;
  date: string;
  time: string;
  country: string;
  event: string;
  tier: "high" | "medium";
  actual: string;
  consensus: string;
  previous: string;
  description?: string;
  surprise: "above" | "below" | "inline" | null;
};

export const COUNTRY_CCY: Record<string, string> = {
  "United States": "USD", "Euro Zone": "EUR", Germany: "EUR", France: "EUR", Italy: "EUR", Spain: "EUR",
  "United Kingdom": "GBP", Japan: "JPY", Switzerland: "CHF", Canada: "CAD", Australia: "AUD", "New Zealand": "NZD",
  Sweden: "SEK", Norway: "NOK", China: "CNY", "Hong Kong": "HKD", Singapore: "SGD", India: "INR", "South Korea": "KRW",
  Taiwan: "TWD", Mexico: "MXN", Brazil: "BRL", "South Africa": "ZAR", Turkey: "TRY", Poland: "PLN"
};

export const CCY_CHART: Record<string, string> = {
  USD: "DX-Y.NYB", EUR: "EURUSD=X", GBP: "GBPUSD=X", JPY: "USDJPY=X", CHF: "USDCHF=X", CAD: "USDCAD=X", AUD: "AUDUSD=X",
  NZD: "NZDUSD=X", SEK: "USDSEK=X", NOK: "USDNOK=X", CNY: "USDCNY=X", HKD: "USDHKD=X", SGD: "USDSGD=X", INR: "USDINR=X",
  KRW: "USDKRW=X", TWD: "USDTWD=X", MXN: "USDMXN=X", BRL: "USDBRL=X", ZAR: "USDZAR=X", TRY: "USDTRY=X", PLN: "USDPLN=X"
};

const GROUPS: FxItem["group"][] = ["Index", "G10", "EM", "Cross"];

export function MacroStrip({ strip }: { strip: Strip | null }) {
  if (!strip?.items?.length) return null;
  return (
    <dl className="tape-stats macro-strip" title={`${strip.source || ""} · ${strip.latency || ""}`}>
      {strip.items.map((item) => (
        <div key={item.id}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
          <small>{item.asOf || " "}</small>
        </div>
      ))}
    </dl>
  );
}

export function useStrip() {
  const [strip, setStrip] = useState<Strip | null>(null);
  useEffect(() => {
    let cancel = false;
    api<Strip>("/api/macro/strip").then((res) => { if (!cancel && res.ok) setStrip(res); }).catch(() => null);
    return () => { cancel = true; };
  }, []);
  return strip;
}

export function FxBoard({ onOpen, onEvent }: { onOpen: (symbol: string) => void; onEvent: (event: EconEvent) => void }) {
  const [board, setBoard] = useState<FxPayload | null>(null);
  const [events, setEvents] = useState<EconEvent[]>([]);
  const [error, setError] = useState("");
  const strip = useStrip();

  useEffect(() => {
    let cancel = false;
    const load = () => api<FxPayload>("/api/fx/board")
      .then((res) => {
        if (cancel) return;
        if (!res.ok) setError(res.error || "No rates");
        else {
          setError("");
          setBoard(res);
        }
      })
      .catch((err: Error) => { if (!cancel) setError(err.message); });
    load();
    const timer = window.setInterval(load, 120000);
    api<{ ok: boolean; items: EconEvent[] }>("/api/calendar/macro?back=0&ahead=14")
      .then((res) => { if (!cancel) setEvents((res.items || []).filter((e) => e.tier === "high")); })
      .catch(() => null);
    return () => {
      cancel = true;
      window.clearInterval(timer);
    };
  }, []);

  const items = board?.items || [];
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = events.filter((e) => e.date >= today && !e.actual).slice(0, 24);

  return (
    <div className="board fx">
      <header className="board-head">
        <div>
          <strong>FX · RATES</strong>
          <span>{items.length ? `${items.length} instruments · DXY, G10, EM, crosses` : "Loading rates"}</span>
        </div>
        <p>
          <em>SOURCE</em> {board?.source || "Yahoo Finance chart"}
          <em>AS OF</em> {when(board?.asOf)}
          <em>NOTE</em> {board?.latency || "Delayed indicative rates."}
        </p>
      </header>
      <MacroStrip strip={strip} />
      {error ? <p className="tape-empty">{error}</p> : null}
      <div className="split-board">
        <div className="board-scroll">
          <table>
            <thead>
              <tr>
                <th>Pair</th>
                <th>Name</th>
                <th>Last</th>
                <th>Chg</th>
                <th>Chg %</th>
                <th>Low</th>
                <th>High</th>
                <th>52w range</th>
                <th>5d</th>
              </tr>
            </thead>
            <tbody>
              {GROUPS.map((group) => {
                const rows = items.filter((item) => item.group === group);
                if (!rows.length) return null;
                return (
                  <Fragment key={group}>
                    <tr className="group-row"><td colSpan={9}>{group === "Index" ? "Dollar index" : group === "Cross" ? "Crosses" : group}</td></tr>
                    {rows.map((item) => (
                      <tr key={item.symbol} onClick={() => onOpen(item.symbol)}>
                        <td>
                          {item.group === "Index" ? item.code : `${item.base}/${item.quote}`}
                          {quoteStale(item.asOf) ? <small className="stale"> stale</small> : null}
                        </td>
                        <td className="board-name">{item.name}</td>
                        <td>{num(item.last, item.digits)}</td>
                        <td className={tone(item.change)}>{signed(item.change, item.digits)}</td>
                        <td className={tone(item.changePct)}>{signed(item.changePct, 2, "%")}</td>
                        <td>{num(item.low, item.digits)}</td>
                        <td>{num(item.high, item.digits)}</td>
                        <td><RangeBar low={item.yearLow} high={item.yearHigh} last={item.last} /></td>
                        <td><Spark values={item.spark} /></td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <aside className="side-stack">
          {board?.matrix ? (
            <section>
              <h3>Cross rates <small>row per 1 unit of column</small></h3>
              <table className="matrix">
                <thead>
                  <tr>
                    <th />
                    {board.matrix.ccys.map((c) => <th key={c}>{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {board.matrix.rows.map((row) => (
                    <tr key={row.ccy}>
                      <td>{row.ccy}</td>
                      {row.cells.map((cell, i) => (
                        <td key={i} className={cell == null ? "diag" : ""}>{cell == null ? "—" : crossFmt(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}
          <section>
            <h3>High-impact prints <small>next 14 days · ET</small></h3>
            <div className="mini-list">
              {upcoming.map((e) => (
                <button key={e.id} onClick={() => onEvent(e)}>
                  <time>{e.date.slice(5)} {e.time}</time>
                  <b>{COUNTRY_CCY[e.country] || e.country.slice(0, 3).toUpperCase()}</b>
                  <span>{e.event}</span>
                  <small>{e.consensus ? `c ${e.consensus}` : e.previous ? `p ${e.previous}` : ""}</small>
                </button>
              ))}
              {!upcoming.length ? <p className="note">Loading the economic calendar…</p> : null}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function crossFmt(value: number) {
  if (value >= 100) return value.toFixed(2);
  if (value >= 1) return value.toFixed(4);
  return value.toPrecision(4);
}
