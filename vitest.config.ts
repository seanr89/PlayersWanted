import { defineConfig } from "vitest/config";

// Unit tests only. Integration tests need local Supabase: see vitest.int.config.ts.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"], exclude: ["**/node_modules/**", "**/*.int.test.ts"] },
});
