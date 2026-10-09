import { useEffect, useState } from "react";
import { addSymbol, moveSymbol, removeSymbol } from "../../shared/watchlist.mjs";

export type WatchMember = { bioguide: string; name: string; chamber?: string };
export type Watch = { symbols: string[]; members: WatchMember[] };

const KEY = "intel:watch:v1";
const EVENT = "intel:watch";

function read(): Watch {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    return { symbols: Array.isArray(raw.symbols) ? raw.symbols : [], members: Array.isArray(raw.members) ? raw.members : [] };
  } catch {
    return { symbols: [], members: [] };
  }
}

function write(next: Watch) {
  localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(EVENT));
}

export function toggleSymbol(symbol: string) {
  const w = read();
  const s = symbol.toUpperCase();
  write({ ...w, symbols: w.symbols.includes(s) ? w.symbols.filter((x) => x !== s) : [...w.symbols, s] });
}

/** Watchlist edits on the same store Alerts reads; `symbols` order is the user's order. */
export function addWatchSymbol(symbol: string) {
  const w = read();
  const next = addSymbol(w.symbols, symbol);
  if (next !== w.symbols) write({ ...w, symbols: next });
}

export function removeWatchSymbol(symbol: string) {
  const w = read();
  write({ ...w, symbols: removeSymbol(w.symbols, symbol) });
}

export function moveWatchSymbol(symbol: string, delta: number) {
  const w = read();
  const next = moveSymbol(w.symbols, symbol, delta);
  if (next !== w.symbols) write({ ...w, symbols: next });
}

export function toggleMember(member: WatchMember) {
  const w = read();
  const has = w.members.some((m) => m.bioguide === member.bioguide);
  write({ ...w, members: has ? w.members.filter((m) => m.bioguide !== member.bioguide) : [...w.members, member] });
}

export function useWatch() {
  const [watch, setWatch] = useState<Watch>(read);
  useEffect(() => {
    const sync = () => setWatch(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return {
    watch,
    hasSymbol: (s: string) => watch.symbols.includes(s.toUpperCase()),
    hasMember: (id: string) => watch.members.some((m) => m.bioguide === id)
  };
}
