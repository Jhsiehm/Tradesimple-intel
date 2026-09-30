export function quoteStale(asOf: string | null | undefined, now = Date.now()) {
  if (!asOf || !sessionOpen(now)) return false;
  const time = Date.parse(asOf);
  if (!Number.isFinite(time)) return false;
  return now - time > 20 * 60 * 1000;
}

export function sessionOpen(now = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(now));
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  const weekday = get("weekday");
  if (weekday === "Sat" || weekday === "Sun") return false;
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  const mins = hour * 60 + minute;
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}
