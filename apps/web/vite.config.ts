import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// Dev server proxies the API; production is served same-origin by FastAPI (never the dev server).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // @jelly is 思维账本's shared look (packages/jelly), the same files the phone app uses; React resolves from this app.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)), "@jelly": fileURLToPath(new URL("../../packages/jelly", import.meta.url)) },
    dedupe: ["react", "react-dom"],
  },
  build: { outDir: "dist", sourcemap: false, assetsDir: "assets" },
  server: { port: 5173, proxy: { "/api": { target: "http://127.0.0.1:8443", changeOrigin: false } } },
  test: { environment: "jsdom", include: ["src/**/*.test.ts", "src/**/*.test.tsx"], setupFiles: ["src/test/setup.ts"] },
});
