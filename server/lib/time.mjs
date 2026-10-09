export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const MONTH = 30 * DAY;

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
