// SOLSTICE YARD — a 5v5 round-based tactical FPS in three.js, handed in by
// this program. It copies game/ and screenshots/ from beside this file to
// /output and writes /output/dossier.json, the summary the judge reads, with
// the vendored make.fun library. Node 22, standard library only. The game
// itself is plain static files under game/ (three.js 0.187.0 vendored) plus
// four real render screenshots; the dossier is built from exactly those files,
// so what the judge reads is what the player plays.
//
// Serve the game locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Fail before packaging if a required gameplay module is missing. This keeps
// the delivered static bundle consistent with the v3 entry point.
const gameplayModules = [
  'main.js',
  'rounds.js',
  'economy.js',
  'map.js',
  'map_night.js',
  'bots.js',
  'weapons.js',
  'hud.js',
];
for (const moduleName of gameplayModules) {
  if (!existsSync(join(here, 'game', 'src', moduleName))) {
    throw new Error(`Missing v3 gameplay module: ${moduleName}`);
  }
}
mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the
// bytes; the others refuse an entry the scorer would refuse (more than 4
// screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of
// game files, in all: game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: 163840, screenshots: { max: 4, max_bytes: 262144 }, game_max_files: 993, game_max_bytes: 50331648 }),
);
