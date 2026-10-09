import type { ModelCfg } from "./agent.mjs";

export const AUTO: "auto";
export function heavyReason(opts?: { question?: string; backtest?: boolean; web?: boolean }): "" | "backtest" | "web research" | "multi-source";
export type Route = { model: string; auto: boolean; pinned: boolean };
export function routeModel(requested: unknown, cfg: ModelCfg): Route;
export function turnModel(route: Route, strong: string, reason: string): string;
export function nudgeToAuto(choice: string): boolean;
export function modelShort(id: string): string;
