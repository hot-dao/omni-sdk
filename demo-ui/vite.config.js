import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import viteCompression from "vite-plugin-compression";
import { NodeGlobalsPolyfillPlugin } from "@esbuild-plugins/node-globals-polyfill";
import { NodeModulesPolyfillPlugin } from "@esbuild-plugins/node-modules-polyfill";
import svgLoader from "vite-plugin-svgr";

export default defineConfig({
  server: {
    port: 1234,
  },

  build: {
    target: "es2020",
  },

  esbuild: {
    target: "es2020",
    legalComments: "none",
    ignoreAnnotations: true,
  },

  optimizeDeps: {
    esbuildOptions: {
      define: { global: "globalThis" },
      plugins: [NodeGlobalsPolyfillPlugin({ buffer: true }, NodeModulesPolyfillPlugin())],
    },
  },

  plugins: [
    svgLoader(),
    react(),
    viteCompression({ algorithm: "brotliCompress" }),
    viteCompression({ algorithm: "gzip" }),
  ],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "~": path.resolve(__dirname, "./src"),
    },
  },
});
