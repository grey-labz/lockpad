import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  oxc: { jsx: { runtime: "automatic" } },
  optimizeDeps: { entries: ["index.html"] },
  server: { watch: { ignored: ["**/target/**", "**/work/**", "**/outputs/**", "**/.demo/**", "**/res/**", "**/docs/evidence/**"] } },
  build: {
    rolldownOptions: {
      onwarn(warning, warn) {
        if (warning.code !== "MODULE_LEVEL_DIRECTIVE" || !warning.id?.includes("/node_modules/framer-motion/")) warn(warning);
      },
    },
  },
});
