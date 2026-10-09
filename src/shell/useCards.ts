import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { api } from "../lib/api";
import { loadDossier, loadLobby, loadPositions, tickerShell, withLobby } from "../markets/useMarkets";
import type { Chamber, DrawerModel } from "../types";
import { PANEL_TITLE, type PanelKind } from "./Panels";
import { clampCard, type WidgetCard } from "./Widgets";

const KEY = "intel:cards:v1";

const PANEL_SIZE: Record<PanelKind, { w: number; h: number }> = {
  watch: { w: 420, h: 420 },
  x: { w: 380, h: 560 },
  lastbuy: { w: 560, h: 520 },
  wire: { w: 420, h: 560 },
  globals: { w: 620, h: 560 },
  supply: { w: 720, h: 640 }
};

const isSplit = (card: WidgetCard) => card.id.startsWith("split:");

function storedCards(): WidgetCard[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((c) => c && c.pinned && !String(c.id).startsWith("split:")) : [];
  } catch {
    return [];
  }
}

export type CardDraft = Omit<WidgetCard, "id" | "pinned" | "x" | "y" | "w" | "h"> & { title: string };

/** Floating cards: pinned dossiers, member cards, panels, and the two-member split compare. */
export function useCards() {
  const [cards, setCards] = useState<WidgetCard[]>(storedCards);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(cards.filter((c) => c.pinned && !isSplit(c))));
  }, [cards]);

  useEffect(() => {
    const fit = () => setCards((current) => current.map((card) => ({ ...card, ...clampCard(card) })));
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const memberPair = cards.filter((card) => card.memberId).slice(0, 2).map((card) => `${card.memberId}:${card.chamber || "house"}`).join("|");
  useEffect(() => splitCompare(memberPair, setCards), [memberPair]);

  function placeCard(id: string, model: DrawerModel, size: { w: number; h: number }) {
    setCards((current) => {
      const rest = current.filter((card) => card.id !== id);
      const placed = clampCard({ id, title: model.title, pinned: true, x: 64 + (rest.length % 5) * 28, y: 88 + (rest.length % 5) * 24, ...size, model });
      return [...rest, { id, title: model.title, pinned: true, model, x: placed.x ?? 64, y: placed.y ?? 88, w: placed.w ?? size.w, h: placed.h ?? size.h }];
    });
  }

  function openCard(partial: CardDraft) {
    const id = `${partial.memberId || partial.title}-${Date.now()}`;
    const wide = Boolean(partial.model?.tables?.length);
    const placed = clampCard({
      ...partial,
      id,
      pinned: true,
      x: 72 + (cards.length % 5) * 26,
      y: 92 + (cards.length % 5) * 26,
      w: partial.memberId ? 420 : wide ? 560 : 360,
      h: partial.memberId ? 520 : wide ? 560 : 380
    });
    setCards((current) => [...current, { ...partial, id, pinned: true, x: placed.x ?? 72, y: placed.y ?? 92, w: placed.w ?? 360, h: placed.h ?? 380 }]);
  }

  function openMember(bioguide: string, seat: Chamber, name?: string) {
    setCards((current) => {
      if (current.some((card) => card.memberId === bioguide)) return current;
      const placed = clampCard({ id: bioguide, title: "Member", pinned: true, x: 88 + (current.length % 4) * 28, y: 96 + (current.length % 4) * 24, w: 460, h: 600, memberId: bioguide, chamber: seat });
      return [...current, { ...placed, id: bioguide, title: name || "Member", pinned: true, memberId: bioguide, chamber: seat, x: placed.x || 88, y: placed.y || 96, w: placed.w || 460, h: placed.h || 600 }];
    });
  }

  function openPanel(kind: PanelKind, symbol?: string) {
    const id = kind === "supply" ? `panel:supply:${symbol || "AAPL"}` : `panel:${kind}`;
    const title = kind === "supply" ? `Supply chain · ${symbol || "AAPL"}` : PANEL_TITLE[kind];
    setCards((current) => {
      if (current.some((c) => c.id === id)) return current.map((c) => (c.id === id ? { ...c, min: false } : c));
      const size = PANEL_SIZE[kind];
      const n = current.length % 5;
      const base: WidgetCard = { id, title, pinned: true, kind, symbol, x: window.innerWidth - size.w - 32 - n * 28, y: 84 + n * 28, ...size };
      return [...current, { ...base, ...clampCard(base) }];
    });
  }

  async function pinSymbol(symbol: string) {
    const id = `${symbol}-dossier`;
    placeCard(id, tickerShell(symbol), { w: 440, h: 560 });
    const loaded = await loadDossier(symbol).catch(() => null);
    if (!loaded) return;
    const { lobbyClient, ...model } = loaded;
    setCards((current) => current.map((card) => (card.id === id ? { ...card, title: model.title, model } : card)));
    if (!lobbyClient) return;
    const lines = await loadLobby(lobbyClient);
    setCards((current) => current.map((card) => (card.id === id && card.model ? { ...card, model: withLobby(card.model, lines) } : card)));
  }

  async function openPositions(symbol: string) {
    const res = await loadPositions(symbol).catch(() => null);
    if (res) placeCard(`${symbol}-positions`, res.model, { w: 640, h: 600 });
  }

  return {
    cards,
    openCard,
    openMember,
    openPanel,
    pinSymbol,
    openPositions,
    close: (id: string) => setCards((current) => current.filter((card) => card.id !== id)),
    change: (id: string, next: Partial<WidgetCard>) => setCards((current) => current.map((card) => (card.id === id ? { ...card, ...next } : card))),
    collapseAll: () => setCards((current) => current.map((card) => ({ ...card, min: true }))),
    closeAll: () => setCards([]),
    dropUnpinned: () => setCards((current) => current.filter((card) => card.pinned))
  };
}

function splitCompare(memberPair: string, setCards: Dispatch<SetStateAction<WidgetCard[]>>) {
  const parts = memberPair.split("|").filter(Boolean);
  if (parts.length < 2) {
    setCards((current) => (current.some(isSplit) ? current.filter((card) => !isSplit(card)) : current));
    return;
  }
  const [left, right] = parts.map((part) => {
    const [id, side] = part.split(":");
    return { id, side };
  });
  let cancel = false;
  const place = (model: DrawerModel) => {
    if (cancel) return;
    const cardId = `split:${left.id}:${right.id}`;
    setCards((current) => {
      const rest = current.filter((card) => !isSplit(card));
      const placed = clampCard({ id: cardId, title: model.title, pinned: true, x: 128, y: 128, w: 440, h: 480, model });
      return [...rest, { id: cardId, title: model.title, pinned: true, model, x: placed.x ?? 128, y: placed.y ?? 128, w: placed.w ?? 440, h: placed.h ?? 480 }];
    });
  };
  if (left.side !== right.side) {
    place({ title: "Split", meta: "Different chambers", rows: [{ label: "Roll calls", value: "These two seats are not on the same roll-call list." }] });
    return () => { cancel = true; };
  }
  api<{
    ok: boolean;
    latency?: string;
    shared?: number;
    a?: { name: string };
    b?: { name: string };
    splits?: { id: string; question: string; date: string; a: string; b: string }[];
  }>(`/api/congress/compare?a=${left.id}&b=${right.id}&chamber=${left.side}`)
    .then((res) => {
      if (!res.ok || !res.a || !res.b) return;
      const splits = res.splits || [];
      place({
        title: `${res.a.name} / ${res.b.name}`,
        meta: res.latency,
        rows: splits.length
          ? splits.map((row) => ({ label: `${row.a} / ${row.b}`, value: row.question || "Roll call" }))
          : [{ label: "Split", value: res.shared ? "Same vote on every shared roll call in this window." : "No shared roll call in this window." }],
        links: splits.map((row) => ({ label: (row.date || "").slice(0, 10), value: row.question || "Roll call", action: `vote:${row.id}` }))
      });
    })
    .catch(() => null);
  return () => { cancel = true; };
}
