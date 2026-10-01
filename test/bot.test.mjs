import { test } from "node:test";
import assert from "node:assert/strict";
import { composePost, headline, linkFacets, oauthHeader, postLength, reasons, selectPosts } from "../scripts/botlib.mjs";

const base = { person: "John W. Rose", bioguide: "R000612", chamber: "house", party: "R", state: "TN", district: "TN-6", symbol: "GOOGL", asset: "Alphabet", side: "sell", type: "Sale", amount: "$250,001 - $500,000", amountLow: 250001, traded: "2025-06-03", filed: "2026-09-12", lag: 466, link: "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035420.pdf" };

test("reasons flags late, near-hearing, and large trades only", () => {
  assert.deepEqual(reasons(base), ["late", "large"]);
  assert.deepEqual(reasons({ ...base, lag: 10, amountLow: 1001, near: { gap: 2 } }), ["near"]);
  assert.deepEqual(reasons({ ...base, lag: 10, amountLow: 1001, near: null }), []);
});

test("headline is factual", () => {
  assert.equal(headline(base, ["late"]), "Filed 466 days late");
  assert.equal(headline({ ...base, near: { gap: 2, laneName: "House Committee on Armed Services" } }, ["near"]), "Traded 2 days before a House Armed Services hearing");
  assert.equal(headline({ ...base, near: { gap: -1, laneName: "Senate Committee on Banking, Housing, and Urban Affairs" } }, ["near"]), "Traded 1 day after a Senate Banking, Housing, and Urban Affairs hearing");
});

test("selectPosts takes new notable filings, one per report, skips posted ids, and caps", () => {
  const trades = [
    { ...base, id: "a" },
    { ...base, id: "b", lag: 50 },
    { ...base, id: "c", link: "https://x/2.pdf", lag: 12, amountLow: 1001, near: { gap: 3 } },
    { ...base, id: "d", link: "https://x/3.pdf", lag: 5, amountLow: 1001 },
    { ...base, id: "e", link: "https://x/4.pdf", filed: "2026-08-01" },
    { ...base, id: "f", link: "https://x/5.pdf", lag: 60 }
  ];
  const r = selectPosts(trades, { today: "2026-09-13", sinceDays: 3, state: { posted: { f: "2026-09-12" } } });
  assert.deepEqual(r.posts.map((p) => p.trade.id), ["a", "c"]);
  assert.equal(r.posts[0].siblings, 1);
  assert.equal(r.lastFiled, "2026-09-12");
  assert.equal(selectPosts(trades, { today: "2026-09-13", max: 1 }).posts.length, 1);
  assert.equal(selectPosts(trades, { today: "2026-09-13", state: { lastFiled: "2026-09-12" } }).posts.length, 0);
});

test("composePost fits Bluesky and X limits and keeps the filing link and caveat", () => {
  const pick = { trade: { ...base, id: "a" }, why: ["late", "large"], siblings: 3 };
  const bsky = composePost(pick, { network: "bluesky", refYear: 2026 });
  assert.match(bsky.text, /^Filed 466 days late: Rep\. John W\. Rose \(R-TN-6\) sold \$250k–\$500k GOOGL · traded Jun 3, 2025, filed Sep 12 \(466d\) \(\+3 more in this report\)\./);
  assert.ok(postLength(bsky.text, "bluesky") <= 300);
  assert.match(bsky.text, /Filing: disclosures-clerk\.house\.gov\/…\/20035420\.pdf$/);
  const x = composePost(pick, { network: "x", refYear: 2026 });
  assert.ok(postLength(x.text, "x", x.display) <= 280);
  assert.ok(x.text.endsWith(base.link));
  const near = composePost({ trade: { ...base, lag: 9, near: { gap: 2, laneName: "House Committee on Financial Services" } }, why: ["near"], siblings: 0 }, { network: "x", refYear: 2026 });
  assert.match(near.text, /Calendar proximity/);
  assert.doesNotMatch(near.text, /insider|suspicious|corrupt/i);
});

test("linkFacets uses UTF-8 byte offsets", () => {
  const text = "Sold $1k–$15k · x\nFiling: host/…/a.pdf";
  const [f] = linkFacets(text, "host/…/a.pdf", "https://host/p/a.pdf");
  const bytes = new TextEncoder().encode(text);
  assert.equal(new TextDecoder().decode(bytes.slice(f.index.byteStart, f.index.byteEnd)), "host/…/a.pdf");
  assert.equal(f.features[0].uri, "https://host/p/a.pdf");
});

test("oauthHeader matches the documented X/Twitter signature example", () => {
  const { signature, header } = oauthHeader({
    method: "POST",
    url: "https://api.twitter.com/1.1/statuses/update.json",
    params: { include_entities: "true", status: "Hello Ladies + Gentlemen, a signed OAuth request!" },
    consumerKey: "xvz1evFS4wEEPTGEFPHBog",
    consumerSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
    token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
    tokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
    nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
    timestamp: 1318622958
  });
  assert.equal(signature, "hCtSmYh+iHYCEqBWrE7C7hYmtUk=");
  assert.match(header, /^OAuth oauth_consumer_key="xvz1evFS4wEEPTGEFPHBog", oauth_nonce=/);
});
