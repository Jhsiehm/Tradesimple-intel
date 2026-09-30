import { when } from "../lib/api";
import type { Meeting } from "../markets/CalendarBoard";
import type { DrawerModel } from "../types";

function committeeIdFor(system: string) {
  const code = system.toUpperCase();
  return code.endsWith("00") ? code.slice(0, -2) : code;
}

export function meetingModel(item: Meeting): DrawerModel {
  return {
    title: item.title,
    meta: [item.status, item.type].filter(Boolean).join(" · ") || "Committee meeting",
    rows: [
      { label: "When", value: `${when(item.date)} UTC` },
      { label: "Chamber", value: item.chamber || "—" },
      { label: "Room", value: item.location || "—" },
      { label: "Nominations", value: item.nominations ? String(item.nominations) : "—" }
    ],
    links: [
      ...(item.committees || []).map((c) => ({ label: "Committee", value: c.name, action: `committee:${committeeIdFor(c.system)}` })),
      ...(item.bills || []).map((b) => ({ label: "Bill", value: b.label, action: `bill:${b.id}` })),
      ...(item.documents || []).map((d) => ({ label: "Document", value: d.name, href: d.url })),
      ...(item.videos || []).map((v) => ({ label: "Video", value: v.name, href: v.url })),
      ...(item.link ? [{ label: "Congress.gov", value: `Event ${item.id}`, href: item.link }] : [])
    ]
  };
}
