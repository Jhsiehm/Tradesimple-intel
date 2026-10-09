import { pool } from "../../lib/pool.mjs";
import { congressGet } from "../../feeds/congressGov.mjs";
import { cleanText } from "../../parsers/senateVoteXml.mjs";

export async function calendar(db) {
  const res = await congressGet(db, "/committee-meeting/119?limit=80", 30 * 60 * 1000);
  if (!res.ok) return res;
  const meetings = (res.body.committeeMeetings || res.body.meetings || []).slice(0, 80);
  const items = [];
  await pool(meetings, 4, async (meeting) => {
    const chamber = String(meeting.chamber || "house").toLowerCase();
    const detail = await congressGet(db, `/committee-meeting/119/${chamber}/${meeting.eventId}`).catch(() => ({ ok: false }));
    const row = detail.ok ? detail.body.committeeMeeting || detail.body : meeting;
    const room = [row.location?.building, row.location?.room].filter(Boolean).join(" ");
    const related = row.relatedItems || {};
    items.push({
      id: String(meeting.eventId),
      date: row.date || meeting.updateDate || "",
      chamber: meeting.chamber || "",
      title: cleanText(row.title) || "Committee meeting",
      location: room,
      status: row.meetingStatus || "",
      type: row.type || "",
      committees: (row.committees || []).map((c) => ({ name: c.name || "", system: String(c.systemCode || "").toLowerCase() })),
      bills: (related.bills || []).map((b) => ({
        id: `${String(b.type || "").toLowerCase()}-${b.congress || 119}-${b.number}`,
        label: `${String(b.type || "").toUpperCase()} ${b.number}`
      })),
      nominations: (related.nominations || []).length,
      documents: (row.meetingDocuments || []).slice(0, 6).map((d) => ({ name: d.name || d.documentType || "Document", url: d.url || "" })).filter((d) => d.url),
      videos: (row.videos || []).slice(0, 2).map((v) => ({ name: v.name || "Video", url: v.url || "" })).filter((v) => v.url),
      link: `https://www.congress.gov/event/119th-congress/${chamber}-event/${meeting.eventId}`
    });
  });
  items.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return {
    ok: true,
    source: "Congress.gov committee meetings",
    asOf: new Date().toISOString(),
    latency: "Scheduled and recent meetings as posted by committee clerks. Times are UTC.",
    items
  };
}
