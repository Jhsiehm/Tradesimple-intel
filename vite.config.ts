import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const demo = process.env.VITE_DEMO === "1";

export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE || "/",
  publicDir: demo ? "demo" : "public",
  build: {
    outDir: demo ? "dist-demo" : "dist",
    // MapLibre alone is ~1 MB minified and loads lazily with the map; the app chunk stays near 330 kB.
    chunkSizeWarningLimit: 1100
  },
  optimizeDeps: {
    exclude: ["maplibre-gl"]
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      // Listed before /api so Ask's event stream matches this entry. Rounds and backtests can run for minutes.
      "/api/ask": {
        target: "http://127.0.0.1:8787",
        proxyTimeout: 600_000,
        configure(proxy) {
          proxy.on("error", (err, _req, res) => {
            if (!res || typeof res.writeHead !== "function" || res.headersSent || res.writableEnded) return;
            const code = err && "code" in err ? String(err.code) : "";
            const message = err instanceof Error ? err.message : "";
            const timedOut = code === "ETIMEDOUT" || code === "ECONNABORTED" || /timeout/i.test(message);
            const error = timedOut
              ? "The API proxy timed out before the model and its tools finished."
              : code === "ECONNREFUSED"
                ? "The API server refused the connection (is it restarting?), so Ask could not run."
                : code === "ECONNRESET" || /socket hang up/i.test(message)
                  ? "The API connection dropped while Ask was still calling the model or a tool."
                  : `The API proxy failed before Ask finished${message ? ` (${message})` : ""}.`;
            res.writeHead(502, { "Content-Type": "application/json", "Cache-Control": "no-store" });
            res.end(JSON.stringify({ ok: false, error, missing: "" }));
          });
        }
      },
      "/api": "http://127.0.0.1:8787",
      "/geo": "http://127.0.0.1:8787"
    }
  }
});
