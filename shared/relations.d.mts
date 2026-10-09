export type NodeType = "member" | "ticker" | "company" | "committee" | "hearing" | "vote" | "agency" | "pac" | "firm" | "insider" | "district" | "note";
export type CategoryId = "trade" | "committee" | "hearing" | "vote" | "contract" | "lobbying" | "pac" | "supply" | "hq" | "insider";

export type Category = { id: CategoryId; label: string; from: NodeType[]; source: string };

export type RelNode = {
  id: string;
  type: NodeType;
  label: string;
  sub?: string;
  x: number;
  y: number;
  pinned?: boolean;
  user?: boolean;
  note?: string;
  kind?: string;
};

export type NodeRef = { id: string; type: NodeType; label: string; sub?: string };

export type RelEdge = {
  id: string;
  from: string;
  to: string;
  cat: CategoryId;
  label: string;
  n: number;
  amount?: number;
  last?: string;
  link?: string;
  source: string;
  asOf: string;
  latency: string;
};

export type Endpoint = { id: string; type: string; label: string };

export type Theory = {
  id: string;
  a: Endpoint;
  b: Endpoint;
  label: string;
  note: string;
  confidence: "low" | "medium" | "high";
  created: string;
  updated: string;
};

export type Graph = { nodes: RelNode[]; edges: RelEdge[]; theories: Theory[] };

export type Expansion = {
  ok: boolean;
  error?: string;
  node: NodeRef;
  category: CategoryId;
  label?: string;
  source: string;
  asOf: string;
  latency: string;
  total: number;
  offset: number;
  limit: number;
  more: boolean;
  nodes: NodeRef[];
  edges: Omit<RelEdge, "id">[];
  note?: string;
};

export type History<T> = { past: T[]; present: T; future: T[] };

export const NODE_TYPES: NodeType[];
export const CATEGORIES: Category[];
export const CATEGORY_IDS: CategoryId[];
export const DEFAULT_EXPAND: Partial<Record<NodeType, CategoryId[]>>;
export const CAP: { page: number; max: number };
export const MAX_NODES: number;
export const MAX_EDGES: number;
export const HISTORY_CAP: number;
export const EMPTY_GRAPH: Graph;

export function nodeId(type: NodeType, key: string): string;
export function parseNode(id: string): { type: NodeType; key: string } | null;
export function categoriesFor(type: NodeType): Category[];
export function clampLimit(raw: unknown, fallback?: number): number;
export function clampOffset(raw: unknown): number;
export function page<T>(list: T[], offset?: number, limit?: number): { items: T[]; total: number; offset: number; limit: number; more: boolean };
export function groupBy<T>(rows: T[], keyOf: (row: T) => string, opts?: { amount?: (row: T) => number; date?: (row: T) => string }): { key: string; n: number; amount: number; last: string; rows: T[] }[];
export function edgeKey(cat: string, a: string, b: string): string;
export function mergeExpansion(graph: Graph, exp: Pick<Expansion, "node" | "nodes" | "edges">, place?: (node: NodeRef, parentId: string | null) => { x: number; y: number }): { graph: Graph; added: string[]; dropped: number };
export function removeNode(graph: Graph, id: string): Graph;
export function moveNodes(graph: Graph, moves: Map<string, { x: number; y: number }>): Graph;
export function addNote(graph: Graph, note: Omit<RelNode, "type" | "user"> & { type?: "note" }): Graph;
export function putTheory(graph: Graph, theory: Theory): Graph;
export function dropTheory(graph: Graph, id: string): Graph;
export function counts(graph: Graph): { byCat: Record<CategoryId, number>; data: number; theories: number; notes: number };
export function neighborhood(graph: Graph, id: string): Set<string>;
export function history<T>(present: T): History<T>;
export function commit<T>(h: History<T>, next: T): History<T>;
export function undo<T>(h: History<T>): History<T>;
export function redo<T>(h: History<T>): History<T>;
