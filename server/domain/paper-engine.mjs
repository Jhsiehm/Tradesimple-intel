/** Version 1 paper-account rules. Preserve these semantics for existing account histories. */
import { createHash } from "node:crypto";
const hashOf = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
const integer = (n, min, max, label) => {
  if (!Number.isSafeInteger(n) || n < min || n > max) throw Error(`${label} must be an integer from ${min} to ${max}.`);
  return n;
};
const text = (s, max, label) => {
  if (typeof s !== "string" || !s.trim() || s.length > max) throw Error(`Provide ${label} up to ${max} characters.`);
  return s.trim();
};
function accountRules(a) {
  if (a.version !== 1 || !/^paper_[a-f0-9]+$/.test(a.id) || !Number.isFinite(Date.parse(a.createdAt)))
    throw Error("Invalid paper account metadata.");
  text(a.title, 200, "account title");
  integer(a.initialCashCents, 1, 100000000000, "Initial cash cents");
  integer(a.maxOrderCents, 1, a.initialCashCents, "Maximum order cents");
  integer(a.maxPositionShares, 1, 1000000, "Maximum shares per symbol");
}
function cleanAction(raw) {
  if (raw.kind === "halt" || raw.kind === "resume")
    return { kind: raw.kind, reason: text(raw.reason, 1000, "control reason") };
  if (raw.kind !== "fill") throw Error("Choose fill, halt or resume.");
  const symbol = text(raw.symbol, 15, "ticker").toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]*$/.test(symbol)) throw Error("Use a ticker symbol.");
  if (!["buy", "sell"].includes(raw.side)) throw Error("Choose buy or sell.");
  return {
    kind: "fill",
    symbol,
    side: raw.side,
    quantity: integer(raw.quantity, 1, 1000000, "Shares"),
    priceCents: integer(raw.priceCents, 1, 1000000000, "Assumed price cents"),
    feeCents: integer(raw.feeCents, 0, 100000000, "Fee cents"),
    approvalReason: text(raw.approvalReason, 1000, "approval reason"),
    priceBasis: text(raw.priceBasis, 1000, "price assumption or source"),
  };
}
function apply(state, account, action) {
  if (action.kind === "halt" || action.kind === "resume") {
    const halted = action.kind === "halt";
    if (state.halted === halted) throw Error(halted ? "Account is already halted." : "Account is already active.");
    return { ...state, halted };
  }
  if (state.halted) throw Error("Paper account is halted. Resume explicitly before recording any fill.");
  const notional = action.quantity * action.priceCents,
    held = state.positions[action.symbol] || 0;
  if (notional + action.feeCents > account.maxOrderCents)
    throw Error("Paper order exceeds the account order limit, including fees.");
  const shares = held + (action.side === "buy" ? action.quantity : -action.quantity);
  if (shares < 0) throw Error("Paper sells cannot exceed held shares; shorting is unavailable.");
  if (shares > account.maxPositionShares) throw Error("Paper position exceeds the per-symbol share limit.");
  const cashCents = state.cashCents + (action.side === "buy" ? -notional : notional) - action.feeCents;
  if (!Number.isSafeInteger(cashCents) || cashCents < 0)
    throw Error("Insufficient paper cash or cash arithmetic limit exceeded.");
  const positions = { ...state.positions };
  if (shares) positions[action.symbol] = shares;
  else delete positions[action.symbol];
  return { ...state, cashCents, positions, feesCents: state.feesCents + action.feeCents, fills: state.fills + 1 };
}
export function verifyPaperLedger(account, events) {
  accountRules(account);
  if (!Array.isArray(events) || events.length > 10000) throw Error("Invalid paper event count.");
  let state = {
    cashCents: account.initialCashCents,
    positions: {},
    feesCents: 0,
    fills: 0,
    halted: false,
    sequence: 0,
    head: hashOf(account),
  };
  const requests = new Set();
  for (const event of events) {
    if (
      event.accountId !== account.id ||
      event.sequence !== state.sequence + 1 ||
      event.previousHash !== state.head ||
      requests.has(event.requestId) ||
      typeof event.requestId !== "string" ||
      text(event.requestId, 100, "request ID") !== event.requestId ||
      !Number.isFinite(Date.parse(event.recordedAt)) ||
      hashOf(cleanAction(event.action)) !== hashOf(event.action)
    )
      throw Error("Paper ledger sequence, action or chain mismatch.");
    requests.add(event.requestId);
    state = { ...apply(state, account, event.action), sequence: event.sequence, head: hashOf(event) };
  }
  return state;
}

export { accountRules, cleanAction, apply };
