import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      JWT_SECRET: 'test-secret-test-secret-test-secret-1234',
      APP_ENCRYPTION_KEY: 'a'.repeat(64),
      DATABASE_URL: 'postgres://foldera:foldera@localhost:5432/foldera_v2_test',
      REDIS_URL: 'redis://localhost:6379/15',
    },
  },
});
