/** Shared constants for server/, src/, and scripts/. */

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/** STOCK Act filing window: a trade filed more than this many days after it happened is "late". */
export const LATE_DAYS = 45;

/** Calendar days between a trade and a hearing that count as "near". Must match NEAR_DAYS in shared/intel.mjs. */
export const NEAR_DAYS = 14;

/** First day of the 119th Congress; trade history starts here. */
export const CONGRESS_START = "2025-01-03";
