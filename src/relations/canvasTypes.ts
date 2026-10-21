import { type KeyboardEvent as ReactKeyboardEvent } from "react";
import { type CategoryId, type Graph, type RelEdge, type RelNode, type Theory } from "../../shared/relations.mjs";
import type { Pt } from "./layout";

export type CanvasHandle = {
  fit: () => void;
  zoom: (f: number) => void;
  center: () => Pt;
  focus: (id: string) => void;
};

export type Props = {
  graph: Graph;
  hidden: Set<CategoryId>;
  selectedId: string | null;
  theoryMode: boolean;
  pendingFrom: string | null;
  onSelect: (id: string | null) => void;
  onMenu: (id: string, at: { x: number; y: number }) => void;
  onCloseMenu: () => void;
  onExpand: (id: string) => void;
  onMove: (moves: Map<string, Pt>) => void;
  onLinkClick: (id: string) => void;
  onLinkDrop: (from: string, to: string) => void;
  onRemove: (id: string) => void;
  onKey: (event: ReactKeyboardEvent) => void;
};

export type View = { x: number; y: number; k: number };
export type Hit =
  | { kind: "node"; node: RelNode }
  | { kind: "edge"; edge: RelEdge }
  | { kind: "theory"; theory: Theory }
  | null;
export type Gesture =
  | { mode: "pan"; sx: number; sy: number; vx: number; vy: number; moved: boolean }
  | { mode: "node"; id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean; touch: boolean }
  | { mode: "link"; id: string; moved: boolean; sx: number; sy: number }
  | { mode: "pinch"; d: number; cx: number; cy: number; view: View }
  | null;
