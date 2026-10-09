/** How this terminal identifies itself to public APIs that ask for a contact-style agent (SEC, OpenStreetMap). */
export const APP_UA = "TradeSimpleIntel/0.1 (local research terminal)";

/**
 * SEC asks automated clients to declare a contact; www.sec.gov (Archives, browse-edgar) answers 403 to an agent
 * without one. SEC_CONTACT (an email) in .env.local replaces the default. Read per request, after loadEnv.
 */
export const secUserAgent = (env = process.env) => `TradeSimpleIntel/0.1 research ${String(env.SEC_CONTACT || "").trim() || "contact@tradesimple.local"}`;

/** SEC agent as of module load (before .env.local is read); prefer secUserAgent(). */
export const SEC_UA = secUserAgent();

/** Sites that refuse non-browser agents (Yahoo, Nasdaq, House Clerk, eFD, news feeds). */
export const BROWSER_UA = "Mozilla/5.0";
