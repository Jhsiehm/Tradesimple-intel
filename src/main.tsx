import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

/** Dev-only icon review sheet at `#icons`. */
const IconSheet = import.meta.env.DEV ? lazy(() => import("./ui/icons/IconSheet").then((m) => ({ default: m.IconSheet }))) : null;
if (IconSheet) window.addEventListener("hashchange", (e) => { if (e.newURL.endsWith("#icons") || e.oldURL.endsWith("#icons")) location.reload(); });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {IconSheet && location.hash === "#icons" ? <Suspense fallback={null}><IconSheet /></Suspense> : <App />}
  </StrictMode>
);
