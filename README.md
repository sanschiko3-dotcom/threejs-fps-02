[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/sanschiko3-dotcom/threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/sanschiko3-dotcom/threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

# SOLSTICE YARD — 5v5 tactical FPS in three.js

A round-based tactical shooter in the style Counter-Strike made famous, set at a
solar power station at dusk. Built for the make.fun `threejs-fps-02` bounty.

## The game

Two teams of five fight over a solar yard with three lanes. The Strikers attack:
plant the device at site A (the inverter hall) or site B (the panel field), or
eliminate the Wardens. The Wardens defend: hold the sites, defuse a planted
device, or run the clock out. First to 8 rounds takes the match.

- **Gunplay** — four weapons (P9 sidearm, Hornet SMG, VK-47 rifle, Longbow
  DMR) plus HE grenades, smoke grenades ($300) and flashbangs ($200).
  Geometric head/torso/limb hitboxes (4× / 1× / 0.6×), right-click ADS
  (FOV zoom, spread halved, slower move), per-weapon recoil patterns, and
  acceleration-based movement with crouching and AABB collision, so stopping
  to aim pays.
- **Tactics** — a plant/defuse objective, a buy menu between rounds with a
  Counter-Strike-shaped economy ($800 start, $300 per kill, $3250 round win,
  $1900 loss plus a loss-streak bonus), and nine bots with roles (entry,
  support, lurker, AWPer, IGL) that follow economy-picked team plans (A
  execute, B execute, split, mid hold, save), throw smoke/flash on executes,
  retake together after a plant (utility first, defuser covered), and react
  to gunfire and footsteps they hear. Bots hold angles, plant when a site is
  clear and defuse when the device is down.
- **The map** — an original solar station: inverter hall, tilted panel rows,
  a control building splitting mid into two doorways, containers and crates
  for cover, and a low amber sun over an indigo dusk sky.
- **Presentation** — procedural WebAudio gunfire, beeps and explosions (no
  audio files), tracers, muzzle flash, hit sparks, a bomb explosion, and a
  HUD with health, armour, ammunition, round timer, score, money, alive
  counts, killfeed and bomb status, plus a live minimap (dots, bomb/plant
  marker, view cones), a damage-direction indicator, and round MVP with
  end-of-match stats (kills, damage, plants, defuses).

## Controls

WASD move · mouse look · click fire · R reload · G throw grenade · E hold to
plant · 1–6 buy during the buy phase · Ctrl crouch · Space jump.

## How it is built

- `game/index.html` — import map for three.js 0.187.0 (vendored byte for
  byte) and the HUD.
- `game/src/` — one module per job: `map` (the yard + waypoint graph),
  `player` (movement + shared AABB slide), `weapons` (defs + view models),
  `bots` (AI: routes, perception, bursts, plant/defuse), `rounds`
  (match state machine + economy + bomb), `effects` (pooled tracers/sparks/
  explosion), `audio` (synthesized SFX), `hud` (DOM), `input` (pointer
  lock + keys), `main` (boot + fixed 60 Hz simulation + render loop).
- The simulation runs on a fixed 60 Hz step kept apart from rendering, with
  pooled vectors and effects — no allocations in the hot loops.
- `main.ts` copies `game/` and `screenshots/` to `/output` and writes
  `dossier.json` with the kit's `vendor/makefun-threejs.ts`.

## Screenshots

`?shot=start|play|plant|end&seed=N` stages a deterministic frame (buy phase,
mid firefight, planted device, round won) for capture; the page sets
`window.__shotReady` when the frame is painted. The four screenshots in
`screenshots/` are real renders of this code in desktop Chrome.

## Play locally

```sh
node serve.ts   # http://localhost:8080
```
