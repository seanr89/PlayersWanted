import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    env: {
      GCLOUD_PROJECT: 'demo-playerswanted',
      FIREBASE_CONFIG: JSON.stringify({
        projectId: 'demo-playerswanted',
        storageBucket: 'demo-playerswanted.appspot.com',
      }),
    },
  },
});
