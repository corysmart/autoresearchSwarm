import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const apiBaseUrl =
  process.env.HARNESS_API_BASE_URL ??
  `http://${process.env.HARNESS_API_HOST ?? "127.0.0.1"}:${process.env.HARNESS_API_PORT ?? 4172}`;

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname),
  server: {
    port: Number(process.env.HARNESS_UI_PORT ?? 4173),
    host: process.env.HARNESS_API_HOST ?? "127.0.0.1",
    proxy: {
      "/api": apiBaseUrl,
      "/health": apiBaseUrl
    }
  },
  publicDir: resolve(__dirname, "public"),
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true
  }
});
