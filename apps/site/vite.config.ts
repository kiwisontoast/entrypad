import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = import.meta.dirname;

// ENTRYPAD_PROFILE=1 builds against React's profiling bundle so the spike's
// <Profiler> reports real render times from optimised code. The e2e perf
// tests use it; normal builds don't.
const profile = process.env.ENTRYPAD_PROFILE === "1";

// Development pages (the drag spike and the font test) are for the team only.
// `vite dev` serves them as usual; production builds leave them out unless
// ENTRYPAD_INTERNAL=1. The e2e build (ENTRYPAD_PROFILE=1) includes them.
const internal = profile || process.env.ENTRYPAD_INTERNAL === "1";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: profile ? [{ find: /^react-dom\/client$/, replacement: "react-dom/profiling" }] : [],
  },
  build: {
    outDir: profile ? "dist-profile" : "dist",
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
        ...(internal && {
          spike: resolve(root, "spike/index.html"),
          fonts: resolve(root, "fonts/index.html"),
        }),
      },
    },
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
