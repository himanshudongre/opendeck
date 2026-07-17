// Bundles the built deck into the hub package so `npx agent-deck` ships one artifact.
import { cpSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const deckDist = join(here, '..', '..', 'deck', 'dist');
const target = join(here, '..', 'dist', 'deck');

if (existsSync(join(deckDist, 'index.html'))) {
  cpSync(deckDist, target, { recursive: true });
  process.stdout.write(`deck assets copied to ${target}\n`);
} else {
  process.stdout.write('deck assets not built yet; hub will serve its missing-deck page\n');
}
