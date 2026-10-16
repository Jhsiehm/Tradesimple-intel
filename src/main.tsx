import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";
import "./theme/chroma.css";

/** Dev-only icon review sheet at `#icons`. */
const IconSheet = import.meta.env.DEV ? lazy(() => import("./ui/icons/IconSheet").then((m) => ({ default: m.IconSheet }))) : null;
const PalettePreview = import.meta.env.DEV ? lazy(() => import("./theme/PalettePreview").then(m => ({ default: m.PalettePreview }))) : null;
if (PalettePreview) window.addEventListener("hashchange", e => { if (e.newURL.endsWith("#palette") || e.oldURL.endsWith("#palette")) location.reload(); });
if (IconSheet) window.addEventListener("hashchange", (e) => { if (e.newURL.endsWith("#icons") || e.oldURL.endsWith("#icons")) location.reload(); });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {PalettePreview && location.hash === "#palette" ? <Suspense fallback={null}><PalettePreview /></Suspense> : IconSheet && location.hash === "#icons" ? <Suspense fallback={null}><IconSheet /></Suspense> : <App />}
  </StrictMode>
);
