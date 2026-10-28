import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // The app's tsconfig keeps JSX as `preserve` for Next.js. A test that imports
  // a server component (for its gate, not its markup) needs it compiled.
  oxc: { jsx: { runtime: "automatic" } },
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
    // *.live.test.ts hits the real database; see vitest.rls.config.ts.
    exclude: ["**/node_modules/**", "src/**/*.live.test.ts"],
  },
});