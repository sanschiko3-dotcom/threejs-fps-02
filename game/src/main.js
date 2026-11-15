// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. Owns the match glue — player shooting, the grenade, planting,
// the bomb on the ground, and every hook the bots and the rounds call. The
// simulation never touches the DOM; the HUD is updated from it once a frame.
// ?shot=start|play|plant|end with &seed=N sets up a deterministic frame for a
// capture, renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './rng.js';
import { createWorld } from './map.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeaponSet, WEAPONS, GRENADE } from './weapons.js';
import { createBots } from './bots.js';
import { createRounds, BUY_SECONDS, ROUND_SECONDS } from './rounds.js';
import { createEffects } from './effects.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(PALETTE.sky, 22, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const effects = createEffects(scene);
const audio = createAudio();
const hud = createHud();
const player = createPlayer(world.colliders, world.spawns.atk[0]);
const weapons = createWeaponSet(camera);
const raycaster = new THREE.Raycaster();
raycaster.far = 140;

const body = player.state;
const playerState = { health: 100, armor: 0, alive: true, hasBomb: false, money: 800 };
let elapsed = 0;
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let plantHold = 0;
let grenade = null;
const direction = new THREE.Vector3();
const muzzle = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

// The bomb on the ground: a small blinking device the player can walk over.
const bombMesh = new THREE.Group();
const bombBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.34, 0.16, 0.24),
  new THREE.MeshStandardMaterial({ color: PALETTE.hazard, roughness: 0.4, metalness: 0.4, emissive: PALETTE.hazard, emissiveIntensity: 0.6 }),
);
bombMesh.add(bombBody);
const bombLight = new THREE.PointLight(PALETTE.hazard, 0, 6);
bombLight.position.y = 0.4;
bombMesh.add(bombLight);
bombMesh.visible = false;
scene.add(bombMesh);

// Grenade mesh, reused for every throw.
const grenadeMesh = new THREE.Mesh(
  new THREE.SphereGeometry(0.09, 10, 8),
  new THREE.MeshStandardMaterial({ color: 0x2e4a35, roughness: 0.5, metalness: 0.5 }),
);
grenadeMesh.visible = false;
scene.add(grenadeMesh);

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  syncCamera();
}

function aliveCounts() {
  return {
    atk: (playerState.alive ? 1 : 0) + bots.aliveCount('atk'),
    def: bots.aliveCount('def'),
  };
}

const hooks = {
  world,
  random: () => random(),
  playerAlive: () => playerState.alive,
  playerPos: () => body.position,
  playerCrouching: () => body.crouching,
  playerSpeed: () => player.groundSpeed(),
  bomb: () => rounds.state.bomb,
  tracer(from, to) {
    effects.tracer(from, to);
  },
  sound(name, dist) {
    if (name === 'enemyShot') audio.enemyShot(dist || 10);
  },
  damagePlayer(dmg, head, bot) {
    if (!playerState.alive) return;
    let amount = dmg;
    if (playerState.armor > 0) {
      const absorbed = Math.min(playerState.armor, amount * 0.5);
      playerState.armor -= absorbed;
      amount -= absorbed;
    }
    playerState.health -= amount;
    hud.damageFlash();
    audio.hurt();
    hud.setHealth(playerState.health, playerState.armor);
    if (playerState.health <= 0) {
      playerState.health = 0;
      playerState.alive = false;
      hud.feed(`${bot.name} killed you`, false);
      hud.banner('You are down', 'Your team fights on — next round you return.', 3000);
      input.releaseLock();
    }
  },
  damageBot(bot, dmg, part, shooter) {
    const killed = bots.damage(bot, dmg, part);
    if (killed) {
      const name = shooter === 'player' ? 'You' : shooter.name;
      hud.feed(`${name} killed ${bot.name}${part === 'head' ? ' (headshot)' : ''}`, shooter === 'player');
      if (shooter === 'player') {
        rounds.killReward();
        hud.setMoney(rounds.state.money);
        audio.kill();
      }
      if (bot.hasBomb) {
        bot.hasBomb = false;
        rounds.dropBomb(bot.body.position.x, bot.body.position.z);
      }
    }
    return killed;
  },
  onPlant(bot) {
    const site = bot.plan === 'B' ? 'B' : 'A';
    if (rounds.plantBomb(site, false)) {
      bot.hasBomb = false;
      hud.setBomb(`DEVICE PLANTED — site ${site}`, 'planted');
    }
  },
  onDefuse(bot) {
    rounds.endRound('def', `Device defused by ${bot.name}`);
    rounds.state.bomb.phase = 'gone';
    hud.setBomb('', '');
  },
  onRoundStart(round, plan) {
    resetPositions(plan);
    hud.setScore(rounds.state.score.atk, rounds.state.score.def, round);
    hud.setMoney(rounds.state.money);
    hud.setBomb('', '');
    hud.showBuy(true);
    hud.banner(`Round ${round}`, 'Buy phase — spend your money, then fight.', 2200);
  },
  onLive() {
    hud.showBuy(false);
    hud.banner('Go go go', 'Plant the device or eliminate the Wardens.', 1800);
    audio.beep();
  },
  onRoundEnd(winner, reason, score) {
    hud.showBuy(false);
    hud.setBomb('', '');
    hud.setScore(score.atk, score.def, rounds.state.round);
    const won = winner === 'atk';
    hud.banner(won ? 'Round won — Strikers' : 'Round lost — Wardens', reason, 3600);
    if (won) audio.roundWin();
    else audio.roundLose();
  },
  onMatchEnd(result, score) {
    hud.banner(result, `Final score ${score.atk} — ${score.def}. Refresh to play again.`, 8000);
  },
  onPlant(site, byPlayer) {
    audio.plant();
    hud.feed(byPlayer ? `You planted the device at ${site}` : `Device planted at site ${site}`, byPlayer);
  },
  onExplode(site) {
    const s = world.sites[site];
    effects.explode(new THREE.Vector3(s.x, 1, s.z));
    audio.explosion();
  },
  onBombDrop(x, z) {
    bombMesh.position.set(x, 0.1, z);
    bombMesh.visible = true;
    hud.setBomb('DEVICE DROPPED — walk over it to pick it up', 'carry');
  },
  onBombPickup(byPlayer) {
    bombMesh.visible = false;
    if (byPlayer) {
      playerState.hasBomb = true;
      hud.setBomb('YOU HAVE THE DEVICE — hold E at a site to plant', 'carry');
    }
  },
  onBombPickupBot() {
    bombMesh.visible = false;
    rounds.pickupBomb(false);
  },
  onBuy(item, price) {
    if (item === 'grenade') {
      weapons.state.grenades += 1;
    } else if (item === 'armor') {
      playerState.armor = 100;
      hud.setHealth(playerState.health, playerState.armor);
    } else {
      weapons.equip(item);
    }
    hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.state.grenades);
    hud.setMoney(rounds.state.money);
    hud.showBuy(rounds.state.phase === 'buy');
  },
};

const bots = createBots(scene, world, hooks);
const rounds = createRounds(hooks);

function resetPositions(plan) {
  player.reset(world.spawns.atk[0]);
  playerState.health = 100;
  playerState.alive = true;
  playerState.hasBomb = false;
  playerState.armor = playerState.armor > 0 ? playerState.armor : 0;
  weapons.refill();
  if (playerState.armor <= 0 && weapons.state.key !== 'pistol') {
    // Keep the bought weapon; a fresh round only refills its magazine.
  }
  const carrier = bots.reset(plan, random);
  rounds.state.bomb.carrier = carrier ? carrier.id : null;
  bombMesh.visible = false;
  grenade = null;
  grenadeMesh.visible = false;
  plantHold = 0;
  hud.setHealth(playerState.health, playerState.armor);
  hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.state.grenades);
  syncCamera();
}

function shoot(spread) {
  if (!weapons.takeRound()) {
    audio.dry();
    return false;
  }
  camera.getWorldDirection(direction);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, direction);
  const targets = world.shootables.concat(bots.hitMeshes());
  const hit = raycaster.intersectObjects(targets, false)[0];
  muzzle.copy(camera.position).addScaledVector(direction, 0.6);
  if (hit) {
    effects.tracer(muzzle, hit.point);
    const bot = hit.object.userData.bot;
    if (bot && bot.alive) {
      const def = weapons.def();
      const part = hit.object.userData.part;
      const dmg = def.damage * (part === 'head' ? def.headMult : 1);
      const killed = hooks.damageBot(bot, dmg, part, 'player');
      hud.hitMarker(killed);
      if (!killed) audio.hit();
      effects.burst(hit.point, PALETTE.hazard, 8);
    } else {
      effects.burst(hit.point, 0xcccccc, 5);
    }
  } else {
    tmpV.copy(camera.position).addScaledVector(direction, 60);
    effects.tracer(muzzle, tmpV);
  }
  weapons.pullTrigger();
  audio.shot(weapons.state.key);
  player.recoil(0.009 + random() * 0.004, (random() * 2 - 1) * 0.004);
  bots.hearShot(body.position, 'atk');
  hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.state.grenades);
  return true;
}

function throwGrenade() {
  if (weapons.state.grenades <= 0 || grenade) return;
  weapons.state.grenades -= 1;
  hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.state.grenades);
  camera.getWorldDirection(direction);
  grenade = {
    pos: camera.position.clone(),
    vel: direction.clone().multiplyScalar(15).add(body.velocity),
    fuse: GRENADE.fuse,
  };
  grenadeMesh.visible = true;
  grenadeMesh.position.copy(grenade.pos);
}

function explodeGrenade(at) {
  effects.explode(at);
  audio.explosion();
  grenadeMesh.visible = false;
  grenade = null;
  const victims = [];
  if (playerState.alive) victims.push({ kind: 'player', pos: body.position, ref: null });
  for (const bot of bots.bots) if (bot.alive) victims.push({ kind: 'bot', pos: bot.body.position, ref: bot });
  for (const v of victims) {
    const d = Math.hypot(v.pos.x - at.x, v.pos.z - at.z);
    if (d > GRENADE.radius) continue;
    const dmg = GRENADE.damage * (1 - d / (GRENADE.radius * 1.4));
    if (v.kind === 'player') hooks.damagePlayer(dmg, false, { name: 'grenade' });
    else hooks.damageBot(v.ref, dmg, 'body', 'player');
  }
}

function stepGrenade(dt) {
  if (!grenade) return;
  grenade.fuse -= dt;
  grenade.vel.y -= 14 * dt;
  grenade.pos.addScaledVector(grenade.vel, dt);
  if (grenade.pos.y < 0.09) {
    grenade.pos.y = 0.09;
    grenade.vel.y = Math.abs(grenade.vel.y) * 0.35;
    grenade.vel.x *= 0.7;
    grenade.vel.z *= 0.7;
  }
  for (const box of world.colliders) {
    if (grenade.pos.y > 0.2 && box.containsPoint(grenade.pos)) {
      grenade.vel.multiplyScalar(-0.35);
      grenade.pos.addScaledVector(grenade.vel, dt * 2);
      break;
    }
  }
  grenadeMesh.position.copy(grenade.pos);
  if (grenade.fuse <= 0) explodeGrenade(grenade.pos.clone());
}

function stepPlant(dt, keys) {
  const bomb = rounds.state.bomb;
  if (rounds.state.phase !== 'live' || !playerState.alive) {
    plantHold = 0;
    return;
  }
  if (!playerState.hasBomb || bomb.phase !== 'carried') {
    plantHold = 0;
    return;
  }
  const wantPlant = keys.has('KeyE');
  let site = null;
  for (const key of ['A', 'B']) {
    const s = world.sites[key];
    if (Math.hypot(body.position.x - s.x, body.position.z - s.z) < s.r) site = key;
  }
  if (wantPlant && site && player.groundSpeed() < 1.2) {
    plantHold += dt;
    hud.setBomb(`PLANTING… ${Math.min(99, Math.floor((plantHold / 3.5) * 100))}% — site ${site}`, 'planted');
    if (plantHold >= 3.5) {
      if (rounds.plantBomb(site, true)) {
        playerState.hasBomb = false;
        hud.setBomb(`DEVICE PLANTED — site ${site}`, 'planted');
      }
      plantHold = 0;
    }
  } else {
    plantHold = 0;
    if (playerState.hasBomb) hud.setBomb('YOU HAVE THE DEVICE — hold E at a site to plant', 'carry');
  }
}

function stepBombPickup() {
  const bomb = rounds.state.bomb;
  if (bomb.phase !== 'dropped' || !playerState.alive) return;
  const d = Math.hypot(body.position.x - bomb.x, body.position.z - bomb.z);
  if (d < 1.6) {
    rounds.pickupBomb(true);
    return;
  }
  for (const bot of bots.bots) {
    if (!bot.alive || bot.team !== 'atk' || bot.hasBomb) continue;
    const bd = Math.hypot(bot.body.position.x - bomb.x, bot.body.position.z - bomb.z);
    if (bd < 1.6) {
      bot.hasBomb = true;
      rounds.pickupBomb(false);
      return;
    }
  }
}

function step(dt) {
  elapsed += dt;
  const keys = input.state.keys;
  const phase = rounds.state.phase;

  if (phase !== 'end') {
    // Freeze time: nobody moves during the buy phase.
    if (phase !== 'buy') {
      player.step(dt, keys);
      bots.step(dt, elapsed, random);
    }
    weapons.step(dt);
  }
  stepGrenade(dt);
  stepPlant(dt, keys);
  stepBombPickup();
  effects.step(dt);
  world.update(dt, rounds.state.bomb.phase === 'planted' ? rounds.state.bomb.site : null);
  rounds.step(dt, aliveCounts());

  // Bomb beacon blink.
  if (bombMesh.visible) {
    bombLight.intensity = 2 + 2 * Math.sin(elapsed * 8);
    bombMesh.rotation.y += dt * 2;
  }

  // HUD refresh.
  hud.setTimer(
    rounds.state.bomb.phase === 'planted' ? rounds.state.bomb.fuseLeft : rounds.state.timeLeft,
    rounds.state.bomb.phase === 'planted',
  );
  hud.setAlive(aliveCounts().atk, aliveCounts().def);
  hud.setCrosshair(weapons.spread(player.groundSpeed()) + (weapons.state.cooldown > 0 ? 0.006 : 0));
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen && started) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    const keys = input.state.keys;
    if (playerState.alive && rounds.state.phase === 'live') {
      if (input.state.firing && weapons.ready()) shoot(shot ? 0 : weapons.spread(player.groundSpeed()));
      if (keys.has('KeyR')) weapons.reload();
      if (keys.has('KeyG')) throwGrenade();
    }
    if (rounds.state.phase === 'buy') {
      if (keys.has('Digit1')) tryBuy('pistol');
      if (keys.has('Digit2')) tryBuy('smg');
      if (keys.has('Digit3')) tryBuy('rifle');
      if (keys.has('Digit4')) tryBuy('sniper');
      if (keys.has('Digit5')) tryBuy('grenade');
      if (keys.has('Digit6')) tryBuy('armor');
    }
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function tryBuy(item) {
  // One purchase per key press: clear the key so holding the digit does not
  // drain the wallet across frames.
  const code = item === 'pistol' ? 'Digit1' : item === 'smg' ? 'Digit2'
    : item === 'rifle' ? 'Digit3' : item === 'sniper' ? 'Digit4'
    : item === 'grenade' ? 'Digit5' : 'Digit6';
  input.state.keys.delete(code);
  rounds.buy(item);
}

const input = createInput(renderer.domElement, (locked) => {
  if (shot) return;
  if (locked) {
    started = true;
    audio.unlock();
    hud.hideOverlay();
    hud.showBuy(rounds.state.phase === 'buy');
  } else if (!rounds.state.matchOver) {
    hud.showOverlay(started ? 'paused' : 'start', `${rounds.state.score.atk} — ${rounds.state.score.def}`);
    hud.showBuy(false);
  }
});

hud.onPlay(() => {
  if (shot) return;
  if (rounds.state.matchOver) {
    window.location.reload();
    return;
  }
  audio.unlock();
  input.requestLock();
});
hud.onBuy((item) => {
  if (rounds.state.phase === 'buy') rounds.buy(item);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Test hook for automated play-testing: read-only snapshot of the match.
window.__game = {
  get phase() { return rounds.state.phase; },
  get round() { return rounds.state.round; },
  get score() { return { ...rounds.state.score }; },
  get money() { return rounds.state.money; },
  get playerAlive() { return playerState.alive; },
  get playerHealth() { return Math.ceil(playerState.health); },
  get alive() { return aliveCounts(); },
  get bomb() { return { ...rounds.state.bomb }; },
  get timeLeft() { return rounds.state.timeLeft; },
};

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  hud.hideOverlay();
  hud.showBuy(false);
  rounds.startRound(random);
  if (name === 'start') {
    // Buy phase at the Striker spawn, looking north-west toward the inverter
    // hall and the low sun, shop open.
    rounds.state.timeLeft = 5.5;
    player.reset({ x: -6, z: 16, yaw: 0.7 });
    settle(30);
    body.yaw = 0.7;
    body.pitch = 0.04;
    hud.showBuy(true);
    hud.setMoney(rounds.state.money);
  } else if (name === 'play' || name === 'plant' || name === 'end') {
    // Force the round live, then stage a firefight at mid. The buy menu
    // belongs to the buy phase only — hide it here.
    rounds.state.phase = 'live';
    rounds.state.timeLeft = 72;
    hud.showBuy(false);
    player.reset({ x: -2, z: 14, yaw: 0 });
    settle(10);
    const enemies = bots.bots.filter((b) => b.team === 'def' && b.alive);
    const target = enemies[0];
    target.body.position.set(0.5, 0, 0);
    target.body.yaw = Math.PI;
    target.mesh.position.set(0.5, 0, 0);
    const mate = bots.bots.find((b) => b.team === 'atk' && b.alive && b.name !== 'player');
    if (mate) {
      mate.body.position.set(-5, 0, 10);
      mate.mesh.position.set(-5, 0, 10);
    }
    if (name === 'play') {
      aimAt(new THREE.Vector3(0.5, 1.3, 0));
      for (let i = 0; i < 3; i += 1) {
        shoot(0);
        settle(6);
      }
      settle(20);
    } else if (name === 'plant') {
      const site = world.sites.A;
      rounds.state.bomb.phase = 'planted';
      rounds.state.bomb.site = 'A';
      rounds.state.bomb.x = site.x;
      rounds.state.bomb.z = site.z;
      rounds.state.bomb.fuseLeft = 34;
      hud.setBomb('DEVICE PLANTED — site A', 'planted');
      const planter = bots.bots.find((b) => b.team === 'atk' && b.alive);
      if (planter) {
        planter.body.position.set(-20, 0, -10);
        planter.mesh.position.set(-20, 0, -10);
      }
      const defBot = enemies[1] || target;
      defBot.body.position.set(-12, 0, -6);
      defBot.body.yaw = Math.PI * 0.75;
      defBot.mesh.position.set(-12, 0, -6);
      player.reset({ x: -6, z: 4, yaw: 0 });
      aimAt(new THREE.Vector3(-18, 1.3, -11));
      shoot(0);
      settle(24);
    } else {
      // End: Strikers took the round by elimination; banner + fallen Wardens
      // staged in the mid doorway so the frame reads at a glance.
      rounds.state.score.atk = 1;
      const fallen = bots.bots.filter((b) => b.team === 'def' && b.alive).slice(0, 2);
      fallen[0].body.position.set(1, 0, -2);
      fallen[0].mesh.position.set(1, 0, -2);
      if (fallen[1]) {
        fallen[1].body.position.set(-3, 0, 3);
        fallen[1].mesh.position.set(-3, 0, 3);
      }
      for (const b of bots.bots) {
        if (b.team === 'def' && b.alive) bots.damage(b, 999, 'body');
      }
      rounds.state.phase = 'end';
      rounds.state.timeLeft = 3.5;
      hud.setScore(1, 0, 1);
      hud.banner('Round won — Strikers', 'Wardens eliminated', 8000);
      player.reset({ x: -2, z: 12, yaw: 0 });
      aimAt(new THREE.Vector3(0, 1.0, -2));
      settle(12);
    }
  }
  hud.setScore(rounds.state.score.atk, rounds.state.score.def, rounds.state.round);
  hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.state.grenades);
  hud.setHealth(playerState.health, playerState.armor);
  hud.setMoney(rounds.state.money);
  paintTwiceThenReady();
}

syncCamera();
hud.setAmmo(weapons.state.mag, weapons.state.reserve, 0);
hud.setHealth(100, 0);
hud.setMoney(800);
if (shot) runShot(shot);
else {
  rounds.startRound(random);
  requestAnimationFrame(frame);
}
