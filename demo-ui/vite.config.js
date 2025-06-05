import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import viteCompression from "vite-plugin-compression";
import svgLoader from "vite-plugin-svgr";

export default defineConfig({
  server: {
    port: 1234,
  },

  plugins: [
    svgLoader(),
    nodePolyfills(),
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
