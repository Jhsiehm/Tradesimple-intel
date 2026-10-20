# TradeSimple Intel visual system

Refined 20 October 2026. Typography was subsequently migrated to native system fonts; see [system-typography.md](system-typography.md) for the current specification. The terminal uses flat, near-black green surfaces with bright destination icons for navigation. Surfaces have no decorative gradient or grain. Semantic market, party, vote, and relationship colors remain meaningful.

## Shared foundations

`src/design/tokens.css` and `terminalTheme.css` own surfaces, text, spacing, controls, focus, and selection. The canvas is #030705, panels #060c08, raised controls #0b130f, and selected surfaces #16271e. IBM Plex Sans provides readable UI and prose; IBM Plex Mono is reserved for technical text. Fonts are bundled locally with their SIL OFL license. Numbers use tabular figures.

Controls use compact 32px heights, 40px on coarse pointers, small corner radii, and visible keyboard focus. Dense table rows share 34px sizing and consistent padding. Numeric assistant table columns align right. Motion is restrained, with a global reduced-motion rule.

## Applied scope

Shared shell, navigation, controls, table styles, search, alerts, research home and workspace, assistant answers, Congress floor, markets, relations canvas labels, and supporting feature styles now follow the same foundations. Research prose remains larger and more spacious than dense terminal tables. Source attribution, freshness, evidence, citations, model controls, and existing workflows remain available.

## Verification

- 966 tests passed; production build and diff whitespace checks passed.
- Live preview ran with demo mode disabled. Checked research, Congress, markets, districts, relationship graph, command search, and assistant views.
- Exercised market filtering, sorting, empty results, map zoom, graph add/undo, mobile workspace navigation, and a completed research answer with source/figure verification.
- Checked desktop 1440×900 and mobile 390×844 layouts and visible keyboard focus.
- Core style detector returned no findings. Token contrast calculations are saved in `artifacts/visual-system/contrast.json`; this is not a complete accessibility certification.
- Full cross-browser and screen-reader testing, OS reduced-motion emulation, and keyboard split-pane resizing were not verified.

## Screenshot evidence

Final desktop research, desktop markets, and mobile research images use the final matte palette and bright icons. Their corresponding before images are in `artifacts/visual-system/`; the mobile baseline was reconstructed from the original core styles. Live data and timestamps differ between captures. Other after images in that folder record intermediate review states before the final palette correction.

Open `artifacts/visual-system/comparison.html` for the three final before/after pairs.
