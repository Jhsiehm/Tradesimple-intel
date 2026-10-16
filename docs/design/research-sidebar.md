# Research workspace sidebar

## Overview

The Research home sidebar is a restrained operational surface: grouped tools, inspectable execution context, and explicit provenance. Its slate treatment supplies structure without theatrical terminal decoration, simulated telemetry, or live market-status claims. Keep the main conversation, composer, Research emblem, and existing brand treatment intact.

Implementation sources: `src/research/ResearchSidebar.tsx`, `src/research/ResearchHome.tsx`, and the operational-sidebar rules in `src/research/home.css`. These rules override the older neutral sidebar styles earlier in that stylesheet.

## Colors

| Role | Implemented value |
| --- | --- |
| Sidebar background | `#12191e` |
| Primary text | `#e1e8ec` |
| Secondary text | `#a6b4bd` |
| Dividers | `#303d46` |
| New-conversation surface / hover | `#202d36` / `#2b3c48` |
| New-conversation border | `#3d4d58` |
| Navigation hover | `#24323c` |
| Navigation icons | `#8ea5b3` |
| Workspace icon | `#96b9c9` |
| Running state / active step | `#a4d5df` |
| Interrupted state / registry error | `#f3bf9b` |
| Keyboard focus | `#b3d4e4` |

Color supplements readable state labels; it never substitutes for them. Use flat surfaces and thin separators rather than decorative glows, gradients, or nested cards.

## Typography

Use the home surface's system sans-serif stack. The workspace title is 14px/600; group headings are 11px/600; navigation is 12px; the current question is 13px with 1.5 line height. Supporting metadata is 10–11px. Counts use tabular numerals. Preserve the existing serif hero heading outside the sidebar.

## Layout

The desktop rail is 292px wide, independently scrollable, with 16px vertical padding, 14px horizontal padding, and 16px section gaps. Its title stays visible while scrolling. Closing it removes the grid column and returns the width to the conversation.

The desktop open preference persists under localStorage key `intel:research-sidebar` as `open` or `closed`; absent or unavailable storage defaults to open. At widths of 760px or less, use a drawer up to 320px wide and 88% of the workspace. Mobile openness is separate, starts closed, and resets on breakpoint changes.

## Shapes

Navigation and the new-conversation button use 3px corners. Navigation rows have a 33px minimum height on desktop and 38px on mobile. Keep these compact utility controls visually subordinate to the composer.

## Components

- **Grouped navigation:** Evidence contains Data Hub and Contract evidence. Experimentation contains Design an experiment, Experiments, Convergence, Event studies, and Stress tests. Knowledge contains Notebooks and Research memory. These launch the existing separate board views through `onTool`; the sidebar does not replace their interfaces.
- **Current investigation:** The latest turn supplies the question, recorded memory mode, completed/failed tool counts, running step, and latest reported tool source. Running, Interrupted, Recorded, and Ready describe application execution state. Model configuration is a provider-availability indicator, not proof of successful execution.
- **Next-request settings:** “Next sources” reflects the current session source choice. Attached screen selection and saved-chat attachment reflect current attachment settings. Do not present these as provenance for an already completed turn. Preserve the distinction between recorded observations and settings that will affect the next request.
- **Provenance disclosure:** The latest tool-source disclosure shows source, as-of, and latency, including explicit missing-value fallbacks. A failed retrieval stays identified as failed. Tool-reported metadata does not certify completeness or freshness.
- **Registry:** Counts on Data Hub, Experiments, Notebooks, and Convergence describe the latest 20 records per category, never all-time totals. Registry read time describes the catalog snapshot, not market freshness. Refresh failures retain any previous snapshot and explain its status.
- **Scheduled research and saved chats:** Keep scheduled research collapsible and expose its actual scheduler state. Conversations are browser-local; research records are server-stored. Preserve saved-chat timestamps and accessible actions.
- **Toggle and drawer:** The Workspace trigger exposes `aria-expanded` and `aria-controls`. Opening the mobile drawer focuses its close button; closing returns focus to the trigger. Escape and backdrop activation close it. The main research content is inert while the drawer is open; mobile tool/chat selections also close it. Do not describe this as an app-wide modal focus trap: the implementation makes the research main area inert, not the entire application shell.
- **Motion and focus:** Sidebar entry lasts 140ms with a small horizontal offset only when reduced motion is not requested. Keyboard focus uses a visible 2px outline. Motion must not imply hidden reasoning or progress estimates.

## Do's and Don'ts

- Show meaningful awareness only when backed by application state or tool observations.
- Keep unavailable, missing, stale-snapshot, and failed states legible.
- Preserve the open/closed workflow on desktop and the dismissible drawer on mobile.
- Do not add fabricated market connectivity, streaming-status lights, estimated completion percentages, or decoration that competes with the question and response.
- Do not make recent-record counts look like collection totals or current attachment settings look like historical evidence.
