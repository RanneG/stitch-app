import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@stitch/shared": path.resolve(__dirname, "../../packages/shared/src"),
    },
  },
  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8765",
        changeOrigin: true,
        // First DeepFace enroll/verify can take minutes (model load); default proxy timeouts are too short.
        timeout: 600_000,
        proxyTimeout: 600_000,
      },
      // Older stitch_rag_bridge.py only exposed GET /health (not under /api).
      "/health": {
        target: "http://127.0.0.1:8765",
        changeOrigin: true,
      },
    },
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
