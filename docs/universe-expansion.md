# Listed and contractor universes

The registry contains 1,500 symbols. The original 504 rows and curated mappings are retained. The 996 additions are SEC exchange-listed symbols matched exactly to the Nasdaq screener, selected by current market capitalization. Explicit preferred shares, warrants, units, ETFs, ETNs, bonds, notes, debentures and funds are excluded by source security names; ADRs and REITs may remain. This is not a US-domicile filter, a historical index, or a survivorship-free backtest universe.

- Markets → S&P 500 → All listed exposes the broader quote universe in pages of 100. Quotes use one upstream screener request, not 1,500 requests.
- Search prioritizes exact symbols before substring matches. Charts, dossiers and explicitly selected insider research load on demand.
- Core automatic scans remain at 101 names. `npm run warm` now warms core ticker details by default; `--all-tickers` explicitly expands it. Lobbying warming only uses existing LDA client mappings.
- The 504 original symbols retain historical insider ingestion scope. New rows set `insiderHistory: false`, preserving the ingestion fingerprint and preventing an automatic 27-quarter rebuild. Explicit research on a new issuer uses the bounded SEC submissions path with its existing completeness warnings. To enable bulk history later, change that flag and run `npm run insiders:backfill`; plan a deliberate batch and verify coverage before claiming completeness.
- No lobbying, PAC, district, or government-parent links are invented for added symbols.

Research → Data Hub → Universe coverage provides a searchable, paginated FY2025 top-500 prime-contract recipient snapshot and a full JSON link at `/api/universe`. The source is USAspending's `/api/v2/search/spending_by_category/recipient/` endpoint with contract award types A/B/C/D, transaction spending level, and action dates 2024-10-01 through 2025-09-30. This ranks recipient records by net obligations, not consolidated parent companies or lifetime award ceilings. FY2025 is used rather than recently closed FY2026, which is still subject to reporting delays.

30 recipient records link through existing parent UEIs in the registry. These inherit previous join provenance; this update does not independently reverify ownership. The remaining 470 are unresolved, which does not mean private. Many records are subsidiaries, joint ventures, private entities or non-US entities. Do not fuzzy-match their names to public tickers or turn recipient totals into parent-company totals without review. The next mapping pass should resolve parent identity and ownership dates with source evidence, and separately flag private and ambiguous entities.

Refresh explicitly with:

```sh
node scripts/universe.mjs --target 1500 --fy 2025 --write
```

Without `--write`, the script validates and reports without changing files. `--sec-file` and `--quotes-file` allow replay of downloaded source JSON. The committed expansion used live SEC and Nasdaq responses downloaded on 2026-10-16 and five live USAspending pages. Files are written only after validating listing count, recipient count, unique recipient identities and descending ranking. Writes replace each file atomically; restart the API after refreshing to reload the registry. USAspending pagination is not an atomic upstream snapshot; a changing ranking causes validation to fail rather than accepting duplicates.
