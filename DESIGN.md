---
name: TradeSimple Intel
description: A matte, dense research terminal with inspectable evidence.
colors:
  terminal-bg: "#030705"
  terminal-panel: "#060c08"
  terminal-frame: "#050a07"
  surface-raised: "#0b130f"
  surface-hover: "#101c15"
  surface-selected: "#16271e"
  ink: "#e7e7da"
  dim: "#b0bdb3"
  faint: "#8fa597"
  line: "#233129"
  control-border: "#637c70"
  accent: "#c7b58e"
  focus: "#d8c69f"
  cyan: "#8ccbc9"
  amber: "#d8b77a"
  positive: "#82c9a0"
  negative: "#ed929a"
  navigation-blue: "#2e7df6"
  navigation-amber: "#faa340"
  navigation-crimson: "#e85553"
  navigation-violet: "#986cff"
  navigation-cyan: "#26e0d4"
  navigation-lime: "#a6e22e"
  navigation-orange: "#ff8a3c"
  navigation-pink: "#ff5cab"
typography:
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.25
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.35
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  ui:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
  prose:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
    fontSize: "12px"
    fontWeight: 400
  code:
    fontFamily: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace'
    fontSize: "13px"
rounded:
  control: "2px"
  panel: "3px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "6": "24px"
components:
  research-submit:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.terminal-bg}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
  research-new:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "11px 12px"
  research-field:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "7px"
  ask-chip:
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "3px 8px"
  research-composer:
    backgroundColor: "{colors.terminal-panel}"
    rounded: "{rounded.panel}"
    padding: "18px"
  navigation-active:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "0"
---

# Design System: TradeSimple Intel

## Overview

This is an extraction of the implemented terminal, not a replacement identity. The user's established direction is a matte near-black surface with a green cast, bright useful navigation icons, and system typography. The interface favors dense inspection, readable values, and visible provenance.

**Key Characteristics:**

- Flat, quiet terminal surfaces with fine boundaries.
- Bright destination icons against restrained labels and controls.
- System sans-serif text, technical monospace, and aligned numeric columns.
- Evidence, assumptions, and coverage limits remain close to results.

Sources: `src/design/tokens.css`, `src/design/base.css`, `src/design/terminalTheme.css`, `src/theme/chroma.css`, and the component styles named below. `src/main.tsx` enables the terminal override by default; the older base palette is not the active terminal palette.

## Colors

### Primary

The muted brass accent marks primary actions and selected navigation. Pale teal supports links and inspection controls. Positive and negative colors retain their data meanings.

### Secondary

The bright navigation pigments identify destinations: research and strait use cyan; today and districts amber; congress blue; markets lime; contracts orange; news violet; map pink; calendar crimson. These mappings come from `src/design/terminalTheme.css`; color does not replace an accessible name or active-state marker.

### Neutral

The background, panel, frame, raised, hover, and selected surfaces form a dark green tonal hierarchy. Warm ink carries primary text; dim and faint text separate supporting metadata. Fine line and control-border colors distinguish content boundaries from interactive fields.

## Typography

Use the shared system UI stack for interface and prose. Use the shared monospace stack for code, hashes, paths, and technical records. The frontmatter records the existing scale; the CSS custom properties remain the implementation source of truth.

Page and panel headings use semibold weight. Compact controls use the UI role; caveats and metadata use the label role. Research prose has a separate, more generous line height. Tables, times, and numeric columns use lining tabular numerals. Do not turn the terminal into an all-monospace interface.

## Layout

The shared spacing rhythm is defined in `src/design/tokens.css`. The application is a viewport-height grid with contained scrolling regions and shrinking columns (`minmax(0, 1fr)` / `min-width: 0`). Desktop navigation can scroll horizontally as space contracts. Research tools constrain reading content to a maximum width (1120px); paragraphs there use a maximum measure (76ch).

Responsive behavior belongs to each surface. Research tools reorganize at 720px, Research Home at 760px, and the shell has additional navigation breakpoints. Coarse-pointer controls increase the shared minimum control height from 32px to 40px. Do not copy a feature-specific breakpoint into every screen.

## Elevation & Depth

Ordinary content uses borders and tonal separation. Floating overlays use shadows: the shared overlay token is `0 8px 24px rgb(0 0 0 / 0.32)`; the Ask panel also has its own stronger overlay shadow in `src/agent/ask.css`. Shadows are existing overlay affordances, not a rule to add depth to every section. Terminal backgrounds remain solid rather than gradients.

## Shapes

Controls have slight corners; panels are only marginally softer. Navigation is square. Fine borders, rectangular fields, and table rules carry the form language. Circles remain useful for status dots and icon geometry rather than general container decoration.

## Components

- **Primary action:** the Research Home submit button uses brass on the terminal background. Its disabled state reduces opacity (`src/research/home.css`).
- **Secondary action:** the New conversation button uses a raised surface and a visible control border; sidebar navigation gains a hover surface (`src/research/home.css`).
- **Fields:** dark raised fields, readable borders, inherited typography, and visible focus. The research composer changes its boundary on focus within (`src/research/home.css`).
- **Chips:** compact outlined Ask controls use the amber border/text on hover; selected chips use amber fill (`src/ask/chat.css`).
- **Navigation:** bright destination icons, quiet inactive labels, and an active bottom boundary plus raised surface (`src/design/terminalTheme.css`, `src/ui/icons/icons.css`).
- **Research figures:** an evidence display within the answer, with a selector, direct value inspection, source links, caveats, and an exact-data table. Its series palette and chart density are local to `src/ask/figures/`, documented in `docs/research-terminal/interactive-figures.md`.

Global focus is a visible two-pixel outline with offset; some research and figure controls use their own established accent. Reduced-motion preferences suppress animation and transition durations (`src/design/base.css`).

## Do's and Don'ts

### Do:

- **Do** preserve matte near-black green terminal surfaces.
- **Do** preserve bright navigation icons and existing semantic color mappings.
- **Do** reuse shared system typography, spacing, focus, and numeric alignment.
- **Do** keep values, provenance, and material limitations readable together.

### Don't:

- **Don't** add a gradient to the terminal surface.
- **Don't** use decorative color changes to imply new data meaning.
- **Don't** replace accessible labels or selected-state markers with color alone.
- **Don't** promote one figure's composition, palette, or breakpoint into a global requirement.
