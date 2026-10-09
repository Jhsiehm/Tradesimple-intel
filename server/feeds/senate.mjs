import { BROWSER_UA } from "../lib/ua.mjs";

export const SESSION = new Date().getUTCFullYear() % 2 === 1 ? 1 : 2;

export const SENATE_MENU = `https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_119_${SESSION}.xml`;

/** senate.gov answers 403 to Node's default user agent. */
export const SENATE_HEADERS = { headers: { "User-Agent": BROWSER_UA } };

export const SENATE_VOTE = (congress, session, roll) => {
  const padded = String(roll).padStart(5, "0");
  return `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${congress}${session}/vote_${congress}_${session}_${padded}.xml`;
};
