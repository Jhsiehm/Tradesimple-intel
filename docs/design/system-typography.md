# System typography migration — 20 October 2026

## Implementation

The existing `src/design/tokens.css` is the authority for typography. UI uses `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`; technical content uses `ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace`. Fonts resolve locally on each operating system. No Apple fonts are distributed.

The scale is 24px page headings, 16px panel headings, 14px body, 13px controls and tables, 15px research prose, 12px metadata, and 13px code. Normal weights are 400/500/600. Shared leading tokens cover UI, headings, panels, and prose. Narrow/coarse-pointer text-entry controls use 16px. Feature styles reference tokens instead of unrelated pixel sizes. Numerical tables and explicit metrics use lining/tabular numerals; the global body no longer forces numerical features onto all prose.

Research retains its structure, writing area, palette, and bright navigation icons. The model control wraps to its own row on narrow screens and has a full-value title; the native option menu retains full model labels. Chart metric cells accommodate price ranges without ellipsis. No calculations, precision, date formatting, routes, or backend behavior were changed by this migration.

Removed `fonts.css`, its import, and the three unused IBM Plex WOFF2 files and accompanying license after checking references. There are no remaining IBM Plex or general UI webfont loads in application source. KaTeX's specialized assets remain.

## Audit and coverage

| Actual surface | Typography treatment and review |
| --- | --- |
| `styles.css`, terminal theme, tokens, `main.tsx` | Central inheritance, native controls, status/footer, tables, dialogs, responsive sizing; reviewed live at laptop, wide desktop, and mobile widths |
| Shell navigation, command bar, widgets, alerts, live notifications | Shared sizes/weights; command dialog and keyboard focus checked live; auxiliary states inspected in source |
| Markets / quotes / watchlists / FX / crypto / positions / supply / calendar | Shared table/control rules; quotes and candle chart checked live; other boards and SVG labels inspected in source |
| Congress / Today / member timelines / votes / legislation | Shared text and SVG inheritance; main destination views opened; member/timeline rules audited |
| Contracts / news / districts / regional navigation | Main views opened, including loading state; DOM popup and map controls migrated |
| Relations canvas and theory editor | Canvas font explicitly reads shared tokens; editor and legend styles migrated; map destination opened |
| Research home, Data Hub, contract evidence, experiment builder/results, Convergence, event studies, stress tests, paper trading, notebooks, research memory | Every tool opened and captured; forms, populated lists, disabled actions, and empty states reviewed; existing result components audited |
| Full-page conversations and portable assistant | Shared prose, citations, code, model/source pickers, saved conversations, task controls; both layouts checked live |
| Backtest results / equity SVG / formulas | Shared table and SVG styles; formula renderer preserved; result/source components audited |
| Error boundaries, loading, preferences, source drawers, attachments, tool menus | Source audit and shared typography migration; not every network-dependent branch was induced |
| Design/material/icon previews | Text sizes migrated; SVG artwork and icon geometry preserved |

There is no standalone editor font package or terminal emulator to configure. JSON/data input and raw output remain monospace. Logo artwork and mathematical fonts are intentional exceptions. MapLibre geographic labels keep `Noto Sans Regular` and the existing glyph endpoint; system font stacks cannot replace those glyph resources. DOM map popups and controls use the UI stack.

`canvasTypography()` reads the central font family and metadata size for candle-chart and relationship labels. Existing ResizeObservers and drawing loops handle resizing; chart tooltip text still uses canvas measurements with the active font. SVG charts inherit CSS. No parallel font configuration was introduced.

## Verification and limitations

- Production build/typecheck passed; all 966 existing tests passed.
- `git diff --check` passed; source scan found no residual IBM Plex references, general webfont imports, or font assets.
- Computed fonts in Research and financial tables resolve to the system stack. Tables compute `lining-nums tabular-nums`; mobile inputs, textareas, and selects compute 16px.
- Captured 1920×1080, 1440×900, and 390×844 layouts. No document-level horizontal overflow was found in Research. Native model menus preserve full labels when the closed control truncates.
- Command input Tab navigation reached Close search with a visible 2px focus outline. Existing reduced-motion and forced-colors rules remain.
- Browser verification was on macOS only. Windows/Android/Linux rendering, full screen-reader coverage, actual browser zoom/text scaling, and every populated/network-error state were not verified. Narrow responsive checks are not a claim of full zoom testing. The alternative non-terminal theme inherits the same root fonts but was not separately exercised live.
- Before/after screenshots and route/tool captures are in `artifacts/system-typography/`. Some route captures include asynchronous loading states. Data timestamps differ between captures.
