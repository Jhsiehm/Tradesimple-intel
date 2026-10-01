import { CARD_H, CARD_W, cardSvg, memberSlug, summarize } from "../../shared/card.mjs";
import { DEMO } from "./api";

const raw = import.meta.env.VITE_PUBLIC_URL || "";
export const PUBLIC_URL = raw ? raw.replace(/\/?$/, "/") : "";

/** The static /m/<slug>/ page exists only in the published demo; elsewhere the hash link is the share link. */
export function memberShareUrl(bioguide: string, name: string) {
  if (DEMO && PUBLIC_URL) return `${PUBLIC_URL}m/${memberSlug(name)}/`;
  return `${location.origin}${location.pathname}#timeline/${bioguide}`;
}

/** Same card the static pages use, drawn client-side: SVG string → <img> → canvas → PNG download. */
export async function downloadMemberCard(timeline: unknown) {
  const s = summarize(timeline);
  if (!s) throw new Error("No timeline to draw");
  const host = (PUBLIC_URL || `${location.origin}${location.pathname}`).replace(/^https?:\/\//, "").replace(/\/$/, "");
  const svg = cardSvg(s, { host });
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Card did not render"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = CARD_W;
    canvas.height = CARD_H;
    canvas.getContext("2d")!.drawImage(img, 0, 0, CARD_W, CARD_H);
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG export failed"))), "image/png"));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(png);
    a.download = `${s.slug}-tradesimple-intel.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } finally {
    URL.revokeObjectURL(url);
  }
}
