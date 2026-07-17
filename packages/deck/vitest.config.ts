import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // main.tsx only mounts <App/>. Micro3D is the WebGL device face —
      // jsdom has no GPU, so it is exercised by the Playwright suite instead;
      // its behavior lives in micro-model.ts, which unit tests do cover.
      exclude: ['src/main.tsx', 'src/screens/Micro3D.tsx'],
      thresholds: {
        lines: 70,
        branches: 70,
        functions: 70,
        statements: 70,
      },
    },
  },
});
