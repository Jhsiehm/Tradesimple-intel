import { billsWithVotes, billRolls } from "../votemap.mjs";
import { billDetail, billVote, calendar, committeeDetail, committeeList, compareMembers, listVotes, memberProfile, memberRoster, searchMembers, voteDetail } from "../congress.mjs";
import { fecForName, lobbyingForClient } from "../lobby.mjs";
import { memberTimeline } from "../timeline.mjs";
import { congressFeed } from "../feed.mjs";
import { memberTrades } from "../positions.mjs";
import { leadersBoard } from "../domain/leaders.mjs";

export const handlers = {
  "congress.bills": ({ db }) => billsWithVotes(db),
  "congress.billRolls": ({ db, params }) => billRolls(db, decodeURIComponent(params.id)),
  "congress.billVote": ({ db, params, query }) => billVote(db, decodeURIComponent(params.id), query.chamber()),
  "congress.bill": ({ db, url }) => billDetail(db, decodeURIComponent(url.pathname.split("/").pop())),
  "congress.calendar": ({ db }) => calendar(db),
  "congress.votes": ({ db, query }) => listVotes(db, query.chamber()),
  "congress.vote": ({ db, params: p }) => voteDetail(db, p.chamber, p.congress, p.session, p.roll),
  "congress.members": ({ db, query }) => searchMembers(db, query.str("q")),
  "congress.compare": ({ db, query }) => compareMembers(db, query.str("a"), query.str("b"), query.chamber()),
  "congress.roster": ({ db }) => memberRoster(db),
  "congress.committees": ({ db }) => committeeList(db),
  "congress.committee": ({ db, params }) => committeeDetail(db, params.id),
  "congress.memberTrades": async ({ db, params }) => ({ ok: true, items: await memberTrades(db, params.id.toUpperCase()) }),
  "congress.memberTimeline": ({ db, params }) => memberTimeline(db, params.id),
  "congress.member": ({ db, params, query }) => memberProfile(db, params.id, query.chamber()),
  "congress.leaders": ({ db, query }) => leadersBoard(db, {
    from: query.str("from"),
    to: query.str("to"),
    days: Math.max(0, Math.min(730, Math.round(Number(query.str("days")) || 0))),
    basis: query.str("basis") === "traded" ? "traded" : "filed",
    waitMs: query.str("wait") === "1" ? 15_000 : 0
  }),
  "congress.feed": ({ db, query }) => congressFeed(db, { days: Math.max(0, Math.min(90, Math.round(Number(query.str("days")) || 0))) }),
  lobby: ({ db, query }) => lobbyingForClient(db, query.str("client")),
  fec: ({ db, query }) => fecForName(db, query.str("name"))
};
