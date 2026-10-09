/** How this terminal identifies itself to public APIs that ask for a contact-style agent (SEC, OpenStreetMap). */
export const APP_UA = "TradeSimpleIntel/0.1 (local research terminal)";

/** SEC asks automated clients to identify themselves. */
export const SEC_UA = APP_UA;

/** Sites that refuse non-browser agents (Yahoo, Nasdaq, House Clerk, eFD, news feeds). */
export const BROWSER_UA = "Mozilla/5.0";
