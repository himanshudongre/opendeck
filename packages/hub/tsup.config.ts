import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  clean: true,
  sourcemap: true,
  // Private workspace packages ship inside the published bundle.
  noExternal: ['@agentdeck/protocol', '@agentdeck/simulator'],
});
