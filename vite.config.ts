import { defineConfig } from "vitest/config"

export default defineConfig({
  // Relative asset paths so the build works from any HTTPS path (root domain or sub-folder).
  base: "./",
  build: {
    target: "es2020",
    assetsInlineLimit: 0,
  },
  server: { host: true },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
})
