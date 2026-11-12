import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (name: string): string => fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@open-rap/model": src("model"),
      "@open-rap/compiler": src("compiler"),
      "@open-rap/runtime": src("runtime"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
