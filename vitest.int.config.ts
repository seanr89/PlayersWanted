import { defineConfig } from "vitest/config";

// Seam 2: application layer against a real local Supabase (`npm run db:start`), RLS on.
export default defineConfig({
  test: {
    globalSetup: ["./src/app-layer/global-setup.ts"],
    include: ["src/**/*.int.test.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
