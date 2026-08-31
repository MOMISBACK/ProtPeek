// SPDX-License-Identifier: MPL-2.0
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      reporter: ['text', 'html'],
    },
    include: ['tests/**/*.test.ts'],
  },
});
