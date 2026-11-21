import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname) } },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.ts'],
      reporter: ['text-summary', 'json-summary'],
      // a floor, not a target: the judged logic (lib/flow, lib/lookup) is held higher by the tests themselves
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
    },
  },
});
