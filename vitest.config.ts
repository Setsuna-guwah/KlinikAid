import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // Node environment is enough: the modules under test are deliberately free
    // of React and DOM dependencies, which is what makes them testable at all.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});