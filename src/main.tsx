import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";
import "./design/tokens.css";
import "./design/terminalTheme.css";

if (import.meta.env.VITE_TERMINAL_COLORS !== "0") document.documentElement.classList.add("tsi-theme", "tsi-terminal");

/** Dev-only icon review sheet at `#icons`. */
const IconSheet = import.meta.env.DEV ? lazy(() => import("./ui/icons/IconSheet").then((m) => ({ default: m.IconSheet }))) : null;
const MaterialSheet = import.meta.env.DEV ? lazy(() => import("./design/MaterialSheet").then((m) => ({ default: m.MaterialSheet }))) : null;
if (MaterialSheet) window.addEventListener("hashchange", (e) => { if (e.newURL.endsWith("#materials") || e.oldURL.endsWith("#materials")) location.reload(); });
if (IconSheet) window.addEventListener("hashchange", (e) => { if (e.newURL.endsWith("#icons") || e.oldURL.endsWith("#icons")) location.reload(); });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {MaterialSheet && location.hash === "#materials" ? <Suspense fallback={null}><MaterialSheet /></Suspense> : IconSheet && location.hash === "#icons" ? <Suspense fallback={null}><IconSheet /></Suspense> : <App />}
  </StrictMode>
);
