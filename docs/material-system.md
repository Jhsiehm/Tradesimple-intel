# Chromatic and material foundation — Phase A

Review route: `http://127.0.0.1:18796/#materials` (Vite development only).
Branch: `feature/chromatic-material-foundation`.

## Scope and incumbent implementation

This is an additive, opt-in foundation. No production surface uses it yet. Stop for review before Phase B.

- `src/styles.css` supplies the global blue-black shell, IBM Plex Mono stack, dense layout, amber focus states, and semantic `--yea`, `--nay`, `--green`, and `--blue` values. It is unchanged.
- `src/shell/commandBar.css` already uses near-black green for search; it is unchanged. Shell navigation, drawer, records, and source metadata are unchanged.
- `src/relations/palette.ts` owns graph categories with labels, shapes, icons, dash patterns, and contrast-tested colors. None are remapped.
- `src/congress/colors.ts` owns party and vote colors. `src/intel/lanes.ts` owns timeline lane colors. Both remain unchanged.
- Markets, charts, map labels, MapLibre rendering, and all backend/state code remain unchanged.
- The dev-only icon sheet in `src/main.tsx` provides the precedent for the guarded, lazy-loaded review route.

Suitable later pilot: an existing research overview's background, behind an opaque content area. A later graph palette pilot must retain current category identity and separately validate every label and mark. Neither pilot is implemented here.

## Files and responsibilities

| File | Responsibility |
| --- | --- |
| `src/design/tokens.css` | Six core tokens, eight chromatic families, surface and intensity tokens scoped to `.tsi-theme` |
| `src/design/materials.css` | Static material classes and five gradient presets; no global element selectors |
| `src/design/assets/grain.png` | Seeded grayscale grain, 256×256, 63,096 bytes |
| `src/design/assets/pigment.png` | Low-frequency mottling with granular variation, 128×128, 13,982 bytes |
| `src/design/assets/wear.svg` | Sparse edge wear, 277 bytes; no filter or animation |
| `scripts/material-textures.py` | Deterministic regeneration of PNG assets, seed 1947, Python standard library only |
| `src/design/MaterialSheet.tsx` | Dev comparison controls, flat/material specimens, complete palette and gradient studies |
| `src/design/preview.css` | Review-page layout only; mobile and desktop arrangements |
| `src/main.tsx` | DEV-guarded lazy review entry at `#materials`; normal app path unchanged |
| `docs/material-system.md` | Audit, usage contract, validation and review boundary |

## Tokens

Core: `--tsi-core-midnight` #0B1F1A, `atlas` #1F4D43, `ivory` #EAE4D6, `stone` #C7B8A3, `slate` #899CA3, `brass` #B08D57.

Chromatic family: `--tsi-chroma-{blue,amber,crimson,violet,cyan,lime,orange,pink}`. Exact base values follow the brief. Each family has:

- `-light`: 68% base + 32% ivory.
- `-dark`: 40% base + 60% midnight.
- `-muted`: 45% base + 55% slate.
- `-alpha`: 16% base + transparent.

Variants use CSS `color-mix(in srgb, ...)`. They are expressive choices, not semantic remappings. Do not use dark, muted, alpha, or arbitrary base swatches as small text without checking the actual contrast. Existing production colors are independent.

## Material contract

Future usage (not yet applied to production):

```tsx
import "./design/tokens.css";
import "./design/materials.css";

<div className="tsi-theme">
  <section className="tsi-material tsi-material--sandy tsi-material--grain tsi-sand--sage">
    <div className="tsi-material-content">Readable content on a clean backing</div>
  </section>
</div>
```

Choose one texture treatment per element: grain, halftone, or archive. Sandy can combine with grain. `::before` provides the directional pigment transition; `::after` provides texture. Both have `pointer-events:none` and sit below direct content children in an isolated stacking context. Applying a material to a component already using these pseudo-elements is unsupported; use a dedicated background wrapper in a future reviewed pilot.

Sandy presets: `tsi-sand--sage`, `--ivory`, `--blue`, `--crimson`, `--violet`. Tune `--tsi-material-direction`, `--tsi-grain-opacity`, and `--tsi-wear-opacity`. Default grain is .18, reduced to .09 for narrow screens; the review slider intentionally overrides this default for explicit comparison. Wear defaults to .10/.07. Avoid animated intensity or moving textures.

Use the gradients for editorial framing, introductions and selected empty states. Use very low intensity on panel framing. Never put textures on tables, inputs, buttons, chart marks, calculations, citations, tooltips, research documents, small text or map labels. Bright gradient areas require opaque content backings; the comparison demonstrates this separation.

Halftone uses a restrained 5px dot pitch. Inspect at actual display scale before adoption; disable if it vibrates or produces moiré. Archive uses only fine edge marks, not literal cracks or distressed typography.

## Performance and accessibility

- About 77 KB of reusable PNG/SVG texture assets in total. Files are module imports, not public-directory assets; production and demo builds exclude them in Phase A.
- No new packages, texture DOM nodes, network feeds, animation loops, SVG filters, blur, canvas redraws or runtime random generation.
- Grain is precomputed and stable. Blend compositing is bounded to the opted-in surface; it is not applied over the viewport.
- Text is above texture, on solid backgrounds when needed. Preview controls use native labels, keyboard behavior, visible focus and disabled states. Palette samples are labeled; color alone carries no data meaning.
- There is no added motion, so reduced-motion users receive the same static view. Forced-colors and print hide material pseudo-elements.
- Review-page primary and secondary text use ivory and #A9B9B0 on #050C09 (calculated contrast 15.59:1 and 9.65:1 respectively); palette swatches are samples, not text backgrounds.

## Validation

Baseline and post-change runs use the same checkout and existing scripts. Output directories are isolated under `/tmp/tsi-material-validation` to avoid overwriting other open production previews.

| Check | Baseline | After foundation |
| --- | --- | --- |
| `npm run typecheck` | Pass | Pass |
| `npm run build -- --outDir /tmp/tsi-material-validation/...` | Pass | Pass |
| `npm test` | 710 pass, 0 fail | 710 pass, 0 fail |
| `npm run build:demo -- --outDir /tmp/tsi-material-validation/...` | Pass | Pass |

The output scan found no MaterialSheet, material selectors, or material assets in either production build. Both production and demo output file inventories and SHA-256 contents are identical to their baseline builds. No production component CSS changed.

Visual inspection: desktop comparison at the browser's normal 1024×900 viewport and mobile at 390×844. Captured the existing Congress view before changes. Inspected the comparison, mobile palette, and preset gallery; exercised preset selection, disable/enable treatment, and archive selection. Final confirmation follows the single adjustment from downscaled to native-size grain tiles. The native controls remained usable and layouts did not overflow horizontally.

Screenshots and full logs are local in `/tmp/tsi-material-validation/`. The browser capability supports viewport dimensions but no device-pixel-ratio override. The inspected browser reported devicePixelRatio 1. Cross-device density validation is therefore limited to that attached browser; physical 1×/2×/3× and cross-browser comparison remain required before broader adoption. Production map/chart interactions were not exhaustively retested: the foundation is not imported into those surfaces, and their code and styles are untouched.

## Review boundary

Phase A is complete when the review page and checks are verified. Request review before applying any style to a production component. Phases B–D, semantic recoloring, global theme replacement, commits to main, and automatic merging are outside this change.

## Approved color pilot — Phases B and C

After Phase A review, the user requested applying the colors. The pilot is intentionally contained:

- `src/congress/TodayBoard.tsx` and `src/design/todayPilot.css`: the existing Disclosure overview uses the namespaced midnight-green panel, ivory/secondary text, and light amber/cyan/violet actions. Content, data, and behavior are unchanged. No texture is added to this information-dense surface.
- `src/relations/palette.ts`: trade/ticker blue, contract/agency amber, lobbying orange, PAC violet, supply cyan, HQ lime, and personal-theory pink use the CSS light-variant formula. Existing committee green, insider teal, and neutral hearing/vote colors remain unchanged. Icons, shapes, labels, category membership and dash patterns are unchanged. Canvas colors use concrete hex values because the canvas rendering API does not resolve CSS custom properties.
- `src/vite-env.d.ts`: two independent rollback flags. Set `VITE_MATERIAL_OVERVIEW=0` to restore the previous overview, or `VITE_CHROMATIC_MAP=0` to restore the legacy graph palette; restart Vite/rebuild afterward. Both default on for this approved pilot.

The global shell, party colors, vote results, chart marks, financial calculations, source information and data pipelines are untouched. Broader adoption remains outside the pilot. Phase A's identical-build result applies to that milestone only; these approved production pilots intentionally change the bundle.

Validation: typecheck and existing relationship palette tests pass, including >=4.5:1 contrast, distinct category colors and a unique theory color. Desktop and 390px mobile Today views were rendered and inspected; existing text and action controls remain legible. Preview remains on the separate feature branch, with no merge or commit to main.

Final pilot checks: production build, demo build, and all 710 tests passed. Relationship Map was rendered with NVDA's category menu, dossier and legend, confirming the new hues across those shared consumers. Full physical-density testing remains outstanding.

## Approved terminal-wide color adoption

The user subsequently requested the colors throughout the terminal. `src/design/terminalTheme.css` now bridges the namespaced palette to existing shell variables on `:root.tsi-terminal`. Main adds the scoped theme by default; `VITE_TERMINAL_COLORS=0` disables it on restart/rebuild. Existing literal dark CSS background colors use scoped variables with their original values as fallbacks. Those substitutions cover shared styles, relationship panels, mobile frames, backtest, boundary and icon surfaces; they do not replace chart fills or data category values.

Navigation destinations have stable data attributes and individual palette accents: Today amber, Congress blue, Markets lime, Contracts orange, News violet, Districts stone, Nav cyan, Map pink and Calendar crimson. Party, vote, trade direction and alert severity mappings remain intact. No global textures are added.

Validation: typecheck, production build, demo build and 710 tests pass. Rendered Today and Congress shell/records views were inspected on a fresh browser tab after existing tabs timed out. High-density physical-device and exhaustive per-feature interaction validation remain outstanding. These colors supersede the earlier Phase A production-isolation boundary by explicit user request; changes remain on the feature branch.

## Full palette continuation and darker terminal

User requested completion across the terminal, then darker surfaces and removal of the decorative grid. Workspace accent colors now carry into titles, counts and selected records through `data-color-section`. Remaining news/weather popovers, alerts, backtest controls and case surfaces use the shared background tokens. Ask uses a cyan accent; watch badges use blue, violet and orange. These accents do not replace severity, party or price-direction meanings.

The backdrop is now #020504, panels #050B08, raised surfaces #0A1510, and frames #030805. The decorative 32px CSS grid is removed from floor, board and map-body backgrounds. Table dividers, plotted data, chart axes and map geometry are retained. Search and the overview follow the darker treatment.

Validation: typecheck and production build pass after the darkening; the preceding full palette run passed all 710 tests and both builds. Today, News and Markets were rendered and inspected with live data. Existing category colors and red/green market values remain distinguishable. Source timestamps are unmodified.
