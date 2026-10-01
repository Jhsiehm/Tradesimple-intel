export type SentenceTrade = {
  person: string;
  chamber?: string;
  party?: string;
  state?: string;
  district?: string;
  symbol?: string;
  asset?: string;
  side?: string;
  type?: string;
  amount?: string;
  traded?: string;
  filed?: string;
  lag?: number | null;
};

export function amountShort(text: string | undefined): string;
export function verbOf(t: SentenceTrade): string;
export function honorific(t: SentenceTrade): string;
export function dayLabel(iso: string | undefined, refYear?: number | string): string;
export function partyTag(t: SentenceTrade): string;
export function tradeSentence(t: SentenceTrade, opts?: { refYear?: number | string; party?: boolean }): string;
