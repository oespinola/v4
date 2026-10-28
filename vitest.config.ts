import { defineConfig } from 'vitest/config';

// Los tests contra Binance Demo Trading (test/demo) solo corren con BINANCE_DEMO_TESTS=1:
// `pnpm test` nunca toca la red ni usa credenciales.
const demo = process.env.BINANCE_DEMO_TESTS === '1';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: demo ? ['node_modules/**'] : ['node_modules/**', 'test/demo/**'],
  },
});
