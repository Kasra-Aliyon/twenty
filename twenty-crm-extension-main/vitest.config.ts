import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['utils/__tests__/**/*.test.ts'],
    alias: {
      '#imports': 'wxt/utils/storage',
    },
  },
});
