import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (name: string): string => fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@rap-transpiler/model": src("model"),
      "@rap-transpiler/compiler": src("compiler"),
      "@rap-transpiler/runtime": src("runtime"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
