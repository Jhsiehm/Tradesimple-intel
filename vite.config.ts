import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const demo = process.env.VITE_DEMO === "1";

export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE || "/",
  publicDir: demo ? "demo" : "public",
  build: {
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
      "/api": "http://127.0.0.1:8787",
      "/geo": "http://127.0.0.1:8787"
    }
  }
});
