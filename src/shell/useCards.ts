import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { api } from "../lib/api";
import { loadDossier, loadLobby, loadPositions, tickerShell, withLobby } from "../markets/useMarkets";
import type { Chamber, DrawerModel } from "../types";
import { cornerSpot, defaultSize, OPEN_LIMIT } from "./cardBounds";
import { PANEL_TITLE, type PanelKind } from "./Panels";
import type { WidgetCard } from "./Widgets";

const KEY = "intel:cards:v1";

const PANEL_SIZE: Record<PanelKind, { w: number; h: number }> = {
  watch: { w: 360, h: 420 },
  x: { w: 360, h: 560 },
  lastbuy: { w: 420, h: 520 },
  wire: { w: 380, h: 560 },
  globals: { w: 420, h: 560 },
  supply: { w: 380, h: 640 }
};

const isSplit = (card: WidgetCard) => card.id.startsWith("split:");
const isPhone = () => typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches;
const topZ = (list: WidgetCard[]) => Math.max(0, ...list.map((c) => c.z || 0));
const openCount = (list: WidgetCard[]) => list.filter((c) => !c.min).length;

/** Keep at most OPEN_LIMIT cards open (one on a phone); the least recently touched collapse to chips. */
function capOpen(list: WidgetCard[], keep: string) {
  const limit = isPhone() ? 1 : OPEN_LIMIT;
  const others = list.filter((c) => !c.min && c.id !== keep).sort((a, b) => (a.z || 0) - (b.z || 0));
  const over = others.length - (limit - 1);
  if (over <= 0) return list;
  const fold = new Set(others.slice(0, over).map((c) => c.id));
  return list.map((c) => (fold.has(c.id) ? { ...c, min: true } : c));
}

/** Put `card` on top, open, and fold the oldest open card if that makes too many. */
function admit(list: WidgetCard[], card: WidgetCard) {
  const rest = list.filter((c) => c.id !== card.id);
  return capOpen([...rest, { ...card, min: false, z: topZ(rest) + 1 }], card.id);
}

function bringUp(list: WidgetCard[], id: string) {
  const z = topZ(list) + 1;
  return capOpen(list.map((c) => (c.id === id ? { ...c, min: false, z } : c)), id);
}

function storedCards(): WidgetCard[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    const kept: WidgetCard[] = Array.isArray(raw) ? raw.filter((c) => c && c.pinned && !String(c.id).startsWith("split:")) : [];
    const phone = isPhone();
    return kept.map((c, i) => ({
      ...c,
      ...(c.z ? null : cornerSpot(c.id, defaultSize(c.w, c.h), i)),
      z: c.z || i + 1,
      min: phone ? true : c.min
    }));
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

  const memberPair = cards.filter((card) => card.memberId).slice(0, 2).map((card) => `${card.memberId}:${card.chamber || "house"}`).join("|");
  useEffect(() => splitCompare(memberPair, setCards), [memberPair]);

  function placeCard(id: string, model: DrawerModel, size: { w: number; h: number }) {
    setCards((current) => {
      const rest = current.filter((card) => card.id !== id);
      return admit(rest, { id, title: model.title, pinned: true, model, ...cornerSpot(id, defaultSize(size.w, size.h), openCount(rest)) });
    });
  }

  function openCard(partial: CardDraft) {
    const id = `${partial.memberId || partial.title}-${Date.now()}`;
    const wide = Boolean(partial.model?.tables?.length);
    const size = defaultSize(partial.memberId ? 400 : wide ? 420 : 340, partial.memberId ? 520 : 560);
    setCards((current) => admit(current, { ...partial, id, pinned: true, ...cornerSpot(id, size, openCount(current)) }));
  }

  function openMember(bioguide: string, seat: Chamber, name?: string) {
    setCards((current) => {
      if (current.some((card) => card.memberId === bioguide)) return bringUp(current, current.find((card) => card.memberId === bioguide)!.id);
      const spot = cornerSpot(bioguide, defaultSize(400, 600), openCount(current));
      return admit(current, { id: bioguide, title: name || "Member", pinned: true, memberId: bioguide, chamber: seat, ...spot });
    });
  }

  function openPanel(kind: PanelKind, symbol?: string) {
    const id = kind === "supply" ? `panel:supply:${symbol || "AAPL"}` : `panel:${kind}`;
    const title = kind === "supply" ? `Supply chain · ${symbol || "AAPL"}` : PANEL_TITLE[kind];
    setCards((current) => {
      if (current.some((c) => c.id === id)) return bringUp(current, id);
      const size = defaultSize(PANEL_SIZE[kind].w, PANEL_SIZE[kind].h);
      return admit(current, { id, title, pinned: true, kind, symbol, ...cornerSpot(id, size, openCount(current)) });
    });
  }

  async function pinSymbol(symbol: string) {
    const id = `${symbol}-dossier`;
    placeCard(id, tickerShell(symbol), { w: 400, h: 560 });
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
    if (res) placeCard(`${symbol}-positions`, res.model, { w: 420, h: 600 });
  }

  return {
    cards,
    openCard,
    openMember,
    openPanel,
    pinSymbol,
    openPositions,
    close: (id: string) => setCards((current) => current.filter((card) => card.id !== id)),
    change: (id: string, next: Partial<WidgetCard>) => setCards((current) => {
      const merged = current.map((card) => (card.id === id ? { ...card, ...next } : card));
      return next.min === false ? bringUp(merged, id) : merged;
    }),
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
      const prev = current.find(isSplit);
      const rest = current.filter((card) => !isSplit(card));
      const spot = prev ? { x: prev.x, y: prev.y, w: prev.w, h: prev.h } : cornerSpot(cardId, defaultSize(400, 480), openCount(rest));
      return admit(rest, { id: cardId, title: model.title, pinned: true, model, ...spot });
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
