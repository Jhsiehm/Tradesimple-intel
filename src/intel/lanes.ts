import type { EventKind } from "../../shared/intel.mjs";

export type DayWindow = [number, number];

export const LANE_COLOR: Record<EventKind, string> = { trade: "#4aa8ff", hearing: "#7f93a6", roll: "#b7c4ce", contract: "#d9b45a", form4: "#5fd0c4" };

/** Last `days` days of the domain, or the whole domain for 0. */
export function presetWindow(len: number, days: number): DayWindow {
  return [days ? Math.max(0, len - days) : 0, Math.max(0, len - 1)];
}
