import { useEffect, useMemo, useState } from "react";
import { api, money, recent, when } from "../lib/api";
import type { DrawerModel, ListItem, MarketLayer, StatusLine } from "../types";

type Feed = {
  ok: boolean;
  missing?: string;
  error?: string;
  source?: string;
  asOf?: string;
  latency?: string;
  detail?: string;
  items?: Record<string, string | number | null>[];
};

export function useMarkets(layer: MarketLayer, query: string, selectedId: string | null, shortSymbol: string) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [dossier, setDossier] = useState<DrawerModel | null>(null);
  const [empty, setEmpty] = useState("Loading filings…");

  useEffect(() => {
    const path =
      layer === "politicians" ? "/api/markets/politicians"
      : layer === "insiders" ? "/api/markets/insiders"
      : layer === "whales" ? "/api/markets/whales"
      : `/api/markets/shorts?symbol=${encodeURIComponent(shortSymbol || "AAPL")}`;
    setFeed(null);
    api<Feed>(path)
      .then((res) => {
        setFeed(res);
        if (res.missing) setEmpty(`Set ${res.missing} to load this feed. ${res.detail || ""}`.trim());
        else if (!res.items?.length) setEmpty(res.error || "No rows on this feed.");
        else setEmpty("");
      })
      .catch((err: Error) => {
        setEmpty(err.message);
        setFeed(null);
      });
  }, [layer, shortSymbol]);

  useEffect(() => {
    if (!selectedId || layer === "shorts" || layer === "politicians") {
      setDossier(null);
      return;
    }
    const symbol = selectedId.match(/\b[A-Z]{1,5}\b/)?.[0];
    if (!symbol) return;
    api<{ ok: boolean; ticker?: { symbol: string; name: string }; error?: string }>(`/api/tickers/${symbol}`)
      .then((res) => {
        if (!res.ok) return;
        setDossier(null);
      })
      .catch(() => setDossier(null));
  }, [selectedId, layer]);

  const items: ListItem[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...(feed?.items || [])]
      .sort((a, b) => recent(b.updated || b.disclosure || b.date || b.traded) - recent(a.updated || a.disclosure || a.date || a.traded))
      .map((row) => toItem(layer, row))
      .filter((item) => `${item.title} ${item.meta}`.toLowerCase().includes(q));
  }, [feed, layer, query]);

  const drawer: DrawerModel | null = useMemo(() => {
    if (dossier) return dossier;
    const row = (feed?.items || []).find((item, index) => itemId(layer, item, index) === selectedId);
    if (!row) return null;
    return {
      title: String(row.person || row.title || row.symbol || "Filing"),
      meta: feed?.latency,
      rows: Object.entries(row)
        .filter(([key]) => key !== "id")
        .slice(0, 8)
        .map(([label, value]) => ({ label, value: String(value ?? "—") }))
    };
  }, [dossier, feed, layer, selectedId]);

  const status: StatusLine = {
    source: feed?.source || "Markets",
    asOf: when(feed?.asOf),
    latency: feed?.latency
  };

  return { items, empty, drawer, status };
}

function itemId(layer: MarketLayer, row: Record<string, string | number | null>, index: number) {
  return String(row.id || `${layer}-${index}`);
}

function toItem(layer: MarketLayer, row: Record<string, string | number | null>): ListItem {
  if (layer === "politicians") {
    const side = String(row.side || "");
    return {
      id: String(row.id),
      title: `${row.symbol || "—"} ${row.person || ""}`.trim(),
      meta: `${side} ${row.amount || ""} · filed ${row.disclosure || "—"}`.trim(),
      tone: /purchase|buy/i.test(side) ? "up" : /sale|sell/i.test(side) ? "down" : ""
    };
  }
  if (layer === "shorts") {
    return {
      id: String(row.id),
      title: String(row.symbol || ""),
      meta: `${row.date || ""} · ${row.shares ?? "—"} shares short`
    };
  }
  return {
    id: String(row.id),
    title: String(row.title || row.form || "Filing"),
    meta: when(String(row.updated || ""))
  };
}

export async function loadDossier(symbol: string): Promise<DrawerModel | null> {
  const res = await api<{
    ok: boolean;
    ticker?: { symbol: string; name: string; districts: string[] };
    lobby?: { missing?: string; filings?: { registrant: string; income: number | null; expenses: number | null; posted: string }[] };
    fec?: { missing?: string; committees?: { name: string; receipts: number | null }[] };
    contracts?: { awards?: { recipient: string; amount: number; agency: string; description: string }[] };
  }>(`/api/tickers/${symbol}`);
  if (!res.ok || !res.ticker) return null;
  return {
    title: `${res.ticker.symbol} ${res.ticker.name}`,
    meta: res.ticker.districts.join(", "),
    rows: [{ label: "Districts", value: res.ticker.districts.join(", ") || "—" }],
    blocks: [
      {
        title: "Lobbying (LDA)",
        lines: res.lobby?.missing
          ? [`Set ${res.lobby.missing}`]
          : (res.lobby?.filings || []).map((f) => `${f.registrant} · income ${money(f.income)} · expenses ${money(f.expenses)}`)
      },
      {
        title: "PAC receipts (FEC)",
        lines: res.fec?.missing
          ? [`Set ${res.fec.missing}. This is separate from lobbying spend.`]
          : (res.fec?.committees || []).map((c) => `${c.name} · ${money(c.receipts)}`)
      },
      {
        title: "Contracts (USASpending)",
        lines: (res.contracts?.awards || []).map((a) => `${money(a.amount)} · ${a.agency} · ${a.description || a.recipient}`)
      }
    ]
  };
}
