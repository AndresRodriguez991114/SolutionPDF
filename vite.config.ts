// @ts-expect-error type error without @types/node package
import path from "node:path";
import { defineConfig } from "vitest/config";
import { normalizePath } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;
const pdfjsDistPath = path.resolve("node_modules/pdfjs-dist");

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: normalizePath(path.join(pdfjsDistPath, "wasm", "*")), dest: "wasm" },
        { src: normalizePath(path.join(pdfjsDistPath, "standard_fonts", "*")), dest: "standard_fonts" },
      ],
    }),
  ],
  test: {
    environment: "jsdom",
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "pdfjs",
              test: /node_modules[\\/]pdfjs-dist[\\/]/,
              priority: 20,
            },
            {
              name: "pdf-lib",
              test: /node_modules[\\/]pdf-lib[\\/]/,
              priority: 10,
            },
            {
              name: "vendor",
              test: /node_modules[\\/]/,
            },
          ],
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
