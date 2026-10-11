import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `pnpm dev` runs the API on 4319 with token "dev"; `pnpm dev:ui` serves the UI and proxies to it.
export default defineConfig({
  root: "src/ui",
  plugins: [react()],
  build: { outDir: "../../dist/ui", emptyOutDir: true },
  server: {
    port: 4320,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4319",
        changeOrigin: true,
        headers: { origin: "http://127.0.0.1:4319" },
      },
    },
  },
});
