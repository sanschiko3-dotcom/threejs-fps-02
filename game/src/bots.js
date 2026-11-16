import { economy, DIFFICULTY } from './economy.js';
import { intersectBody, WEAPONS, armoredDamage, BLOOM, recoilFor } from './weapons.js';
import { obscured } from './utility.js';
// Bots: the other nine players. Each bot is a small state machine — route, hold,
// push, plant, defuse, investigate — driven by a plan drawn per round (A push,
// B push, split, mid hold) and by what it can see and hear. Perception is a
// real line-of-sight raycast against the world's shootables plus a field of view,
// so smoke and corners genuinely hide you. Aiming error shrinks the longer a bot
// holds a target and grows with the target's speed, so stopping to aim pays —
// for the player and against them. All per-frame math reuses scratch vectors.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { slideMove, RADIUS } from './player.js';
import { findRoute, nearestWaypoint } from './map.js';
import { pick, shuffle } from './rng.js';

const NAMES_ATK = ['Dusk', 'Ember', 'Flint', 'Sable'];
const NAMES_DEF = ['Heron', 'Quartz', 'Brine', 'Cobalt', 'Warden'];
const BOT_SPEED_WALK = 3.1;
const BOT_SPEED_PUSH = 4.4;
const THINK_EVERY = 0.15;
const SEE_RANGE = 34;
const HEAR_RANGE = 26;

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _ray = new THREE.Raycaster();

function hasLineOfSight(shootables, from, to) {
  const delta = new THREE.Vector3().subVectors(to,from);
  const dist = delta.length();
  if (dist < 0.01) return true;
  _ray.set(from, delta.normalize());
  _ray.far = dist;
  const hit = _ray.intersectObjects(shootables, false)[0];
  return !hit;
}

function buildBotMesh(team, name) {
  const cloth = new THREE.MeshStandardMaterial({
    color: team === 'atk' ? PALETTE.amber : PALETTE.teal, roughness: 0.8, metalness: 0.05,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x23211e, roughness: 0.85, metalness: 0.05 });
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.95, 0.36), cloth);
  body.position.y = 0.95;
  body.userData.part = 'body';
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.3), dark);
  legs.position.y = 0.25;
  legs.userData.part = 'limb';
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xc9a586, roughness: 0.7 }));
  head.position.y = 1.62;
  head.userData.part = 'head';
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x11131a, roughness: 0.2, metalness: 0.6 }));
  visor.position.set(0, 1.64, -0.16);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.7), dark);
  gun.position.set(0.28, 1.15, -0.3);
  group.add(body, legs, head, visor, gun);
  group.traverse((child) => { child.castShadow = true; });
  return { group, limbMesh: legs, bodyMesh: body, headMesh: head, muzzle: gun };
}

export function createBots(scene, world, hooks) {
  const bots = [];
  const shootables = world.shootables;

  function spawnBot(team, name, spawn, weaponKey) {
    const parts = buildBotMesh(team, name);
    parts.group.position.set(spawn.x, 0, spawn.z);
    parts.group.rotation.y = spawn.yaw;
    parts.bodyMesh.userData.bot = null; // filled below
    parts.headMesh.userData.bot = null;
    scene.add(parts.group);
    const bot = {
      id: `${team}-${name}`,
      team,
      name,
      weaponKey,
      health: 100,
      armor: 0,
      alive: true,
      body: {
        position: new THREE.Vector3(spawn.x, 0, spawn.z),
        velocity: new THREE.Vector3(),
        yaw: spawn.yaw,
        pitch: 0,
        eye: 1.5,
        onGround: true,
        crouching: false,
        height: 1.72,
      },
      mesh: parts.group,
      limbMesh: parts.limbMesh,
      bodyMesh: parts.bodyMesh,
      headMesh: parts.headMesh,
      muzzle: parts.muzzle,
      state: 'route',
      plan: 'mid',
      route: [],
      routeIdx: 0,
      holdUntil: 0,
      holdPos: null,
      target: null,       // { kind: 'player'|'bot', ref, pos: Vector3 }
      targetVisible: 0,   // seconds the current target has been continuously seen
      fightSince: 0,      // time the current fight started; long fights break off
      aimError: 0.06,
      burstLeft: 0,
      burstGap: 0,
      cooldown: 0,
      reloadLeft: 0,
      mag: 30,
      reserve: 90,
      thinkAt: Math.random() * THINK_EVERY,
      hearPos: null,
      plantProgress: 0,
      defuseProgress: 0,
      hasBomb: false,
      speed: BOT_SPEED_WALK,
    };
    parts.bodyMesh.userData.bot = bot;
    parts.headMesh.userData.bot = bot;
    parts.limbMesh.userData.bot = bot;
    bots.push(bot);
    return bot;
  }

  function reset(roundPlan, random) {
    for (const bot of bots) {
      const a=economy.account(bot.name,bot.team);
      Object.assign(a,{alive:bot.alive,armor:bot.armor,helmet:bot.helmet,kit:bot.kit});
      scene.remove(bot.mesh);
    }
    for(const name of NAMES_ATK)economy.account(name,'atk');
    for(const name of NAMES_DEF)economy.account(name,'def');
    bots.length = 0;
    const atkNames = shuffle(random, [...NAMES_ATK]);
    const defNames = shuffle(random, [...NAMES_DEF]);
    for (let i = 0; i < 4; i += 1) {
      const bot = spawnBot('atk', atkNames[i], world.spawns.atk[i + 1], i === 0 ? 'smg' : 'rifle');
      bot.utility = roundPlan.name === 'save' ? null : i%2 ? 'flash' : 'smoke';
      bot.role=['entry','support','lurker','IGL'][i];
      bot.plan = roundPlan.atk[i % roundPlan.atk.length];
    }
    for (let i = 0; i < 5; i += 1) {
      const bot = spawnBot('def', defNames[i], world.spawns.def[i], i === 0 ? 'sniper' : 'rifle');
      bot.utility = roundPlan.name === 'save' ? null : i%2 ? 'flash' : 'smoke';
      bot.role=['AWPer','support','entry','lurker','IGL'][i];
      bot.plan = roundPlan.def[i % roundPlan.def.length];
    }
    bots.forEach((bot,i)=>{
      bot.difficulty=['rookie','veteran','elite'][i%3];
      const a=economy.account(bot.name,bot.team);
      bot.buyDecision=economy.equipBot(a,bot.difficulty);
      bot.weaponKey=a.weapon;
      bot.armor=a.armor;bot.helmet=a.helmet;bot.kit=a.kit;
      bot.mag = WEAPONS[a.weapon].mag;
      bot.reserve = WEAPONS[a.weapon].reserve;
      bot.bloom = 0;
      bot.shots = 0;
      bot.utility=a.smoke?'smoke':a.flash?'flash':null;
      if(bot.buyDecision==='eco')bot.plan='mid';
    });
    // The bomb rides with the first attacker whose plan is a site push.
    const carrier = bots.find((b) => b.team === 'atk' && (b.plan === 'A' || b.plan === 'B'))
      || bots.find((b) => b.team === 'atk');
    if (carrier) carrier.hasBomb = true;
    return carrier;
  }

  function eyePos(bot, out) {
    out.set(bot.body.position.x, bot.body.position.y + bot.body.eye, bot.body.position.z);
    return out;
  }

  function chestPos(bot, out) {
    out.set(bot.body.position.x, bot.body.position.y + 1.15, bot.body.position.z);
    return out;
  }

  // Nearest visible enemy of `bot`. The player is a candidate when alive.
  function perceive(bot, time) {
    let best = null;
    let bestScore = Infinity;
    const eye = eyePos(bot, _v1);
    const candidates = [];
    if (bot.team === 'def' && hooks.playerAlive()) {
      _v2.set(hooks.playerPos().x, hooks.playerPos().y + 1.4, hooks.playerPos().z);
      candidates.push({ kind: 'player', ref: null, pos: _v2.clone(), dist: eye.distanceTo(_v2) });
    }
    for (const other of bots) {
      if (!other.alive || other.team === bot.team) continue;
      chestPos(other, _v2);
      candidates.push({ kind: 'bot', ref: other, pos: _v2.clone(), dist: eye.distanceTo(_v2) });
    }
    for (const cand of candidates) {
      if (cand.dist > SEE_RANGE) continue;
      // Field of view: ~110 degrees around the bot's facing.
      _v3.copy(cand.pos).sub(eye);
      const facing = new THREE.Vector3(-Math.sin(bot.body.yaw), 0, -Math.cos(bot.body.yaw));
      const flat = _v3.clone();
      flat.y = 0;
      if (flat.lengthSq() > 0.01) {
        flat.normalize();
        if (flat.dot(facing) < 0.25 && cand.dist > 6) continue;
      }
      if (obscured(eye,cand.pos) || !hasLineOfSight(shootables, eye, cand.pos)) continue;
      const score = cand.dist + (cand.kind === 'player' && hooks.playerCrouching() ? 6 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = cand;
      }
    }
    return best;
  }

  function setRoute(bot, toId) {
    const fromId = nearestWaypoint(world.waypoints, bot.body.position.x, bot.body.position.z);
    bot.route = findRoute(world.waypoints, fromId, toId);
    bot.routeIdx = 0;
    bot.state = 'route';
  }

  function think(bot, time, random) {
    if (!bot.alive) return;
    const seen = bot.blind>0 ? null : perceive(bot, time);
    if (seen) {
      if (bot.target && bot.target.kind === seen.kind && bot.target.ref === seen.ref) {
        bot.targetVisible += THINK_EVERY;
      } else {
        bot.target = seen;
        bot.targetVisible = 0;
        if (!bot.fightSince) bot.fightSince = time;
      }
      bot.target.pos.copy(seen.pos);
      // A standoff that drags on breaks off: the bot resumes its route
      // instead of strafing in the open forever.
      if (time - bot.fightSince > 7) {
        bot.target = null;
        bot.targetVisible = 0;
        bot.fightSince = 0;
      }
    } else if (bot.target) {
      bot.target = null;
      bot.targetVisible = 0;
      bot.fightSince = 0;
    }

    const bomb = hooks.bomb();
    if(bot.utility && random()<DIFFICULTY[bot.difficulty].utility && ((bot.team==='atk' && bot.body.position.distanceTo(new THREE.Vector3(world.sites[bot.plan==='B'?'B':'A'].x,0,world.sites[bot.plan==='B'?'B':'A'].z))<14) || (bot.team==='def'&&bomb.phase==='planted'))){hooks.utility?.(bot.utility,new THREE.Vector3(bomb.phase==='planted'?bomb.x:world.sites[bot.plan==='B'?'B':'A'].x,1,bomb.phase==='planted'?bomb.z:world.sites[bot.plan==='B'?'B':'A'].z));economy.consume(bot.name,bot.utility);bot.utility=null;bot.regroupUntil=time+2;}
    if(bot.regroupUntil>time){bot.target=null;bot.state='hold';return;}

    // Dropped device: a free attacker fetches it; the last living attacker
    // fetches it even mid-fight, because planting is the win condition.
    const atkAlive = bots.filter((b) => b.alive && b.team === 'atk').length;
    if (bot.team === 'atk' && bomb.phase === 'dropped'
      && (!bot.target || atkAlive <= 1)
      && !bots.some((b) => b.hasBomb && b.alive)) {
      const d = Math.hypot(bot.body.position.x - bomb.x, bot.body.position.z - bomb.z);
      if (d < 1.6) {
        bot.hasBomb = true;
        hooks.onBombPickupBot(bot);
        return;
      }
      if (bot.state !== 'route' || !bot.route.length) {
        const fromId = nearestWaypoint(world.waypoints, bot.body.position.x, bot.body.position.z);
        const toId = nearestWaypoint(world.waypoints, bomb.x, bomb.z);
        bot.route = findRoute(world.waypoints, fromId, toId);
        bot.routeIdx = 0;
        bot.state = 'route';
      }
      return;
    }
    if (bot.team === 'atk' && bot.hasBomb && bomb.phase === 'carried') {
      const site = bot.plan === 'B' ? world.sites.B : world.sites.A;
      const d = Math.hypot(bot.body.position.x - site.x, bot.body.position.z - site.z);
      if (d < site.r && !bot.target) {
        bot.state = 'plant';
        return;
      }
      if (bot.state !== 'route' || !bot.route.length) setRoute(bot, bot.plan === 'B' ? 'bSite' : 'aSite');
      return;
    }
    // Preserve expensive equipment when a retake cannot finish. Saving is a
    // route to spawn followed by an angle hold, not an economy label alone.
    const escapeTime = bot.body.position.distanceTo(new THREE.Vector3(bomb.x,0,bomb.z)) / BOT_SPEED_PUSH;
    const cannotRetake = bomb.phase === 'planted' && bomb.fuseLeft < escapeTime + (bot.kit ? 2.5 : 5) + .8;
    if (bot.team === 'def' && cannotRetake && bot.weaponKey !== 'pistol') {
      bot.saving = true;
      if (bot.saveRoute !== true) {
        setRoute(bot, 'nSpawn');
        bot.saveRoute = true;
      }
      if (bot.routeIdx >= bot.route.length) bot.state = 'hold';
      return;
    }
    if (bot.buyDecision === 'eco' && !bot.hasBomb && bomb.phase !== 'planted' && !bot.target) {
      const anchor = bot.team === 'atk' ? 'sMid' : 'nMid';
      if (!bot.ecoAnchor) {
        setRoute(bot, anchor);
        bot.ecoAnchor = true;
      }
      if (bot.routeIdx >= bot.route.length) bot.state = 'hold';
      return;
    }
    if (bot.team === 'def' && bomb.phase === 'planted') {
      const d = Math.hypot(bot.body.position.x - bomb.x, bot.body.position.z - bomb.z);
      if(!bot.retakeAt){bot.retakeAt=time;setRoute(bot,nearestWaypoint(world.waypoints,world.spawns.def[0].x,world.spawns.def[0].z));}
      if(time-bot.retakeAt<3){bot.target=null;return;}
      if (d < 2.2 && !bot.target && !bots.some(b=>b!==bot&&b.alive&&b.state==='defuse')) {
        bot.state = 'defuse';
        return;
      }
      if ((bot.state !== 'route' || bot.routeIdx >= bot.route.length) && bot.state !== 'defuse') setRoute(bot, bomb.site === 'A' ? 'aSite' : 'bSite');
      return;
    }
    if (bot.hearPos && !bot.target && bot.state !== 'investigate') {
      bot.state = 'investigate';
      bot.holdPos = bot.hearPos;
      bot.hearPos = null;
      return;
    }
    if (bot.target) {
      bot.state = 'fight';
      return;
    }
    // No contact: follow the plan. A bot still walking its route keeps it; a
    // bot that arrived and waited out its hold gets a fresh destination.
    if (bot.team === 'atk') {
      const dest = bot.plan === 'A' ? 'aSite' : bot.plan === 'B' ? 'bSite' : 'midN';
      if (bot.state !== 'route' || !bot.route.length) setRoute(bot, dest);
    } else if (bot.state === 'route' && bot.route.length) {
      // Still walking to the hold — leave it alone.
    } else if (bot.state === 'hold' && bot.holdUntil && time < bot.holdUntil) {
      // Holding the angle — leave it alone.
    } else {
      const dest = bot.plan === 'A' ? 'aHold' : bot.plan === 'B' ? 'bHold' : 'nMid';
      setRoute(bot, dest);
    }
  }

  function stepBot(bot, dt, time, random) {
    if (!bot.alive) return;
    bot.blind=Math.max(0,(bot.blind||0)-dt);
    if(Math.hypot(bot.body.velocity.x,bot.body.velocity.z)>2 && time>(bot.nextStep||0)){hooks.footstep?.(bot);bot.nextStep=time+0.45;}
    bot.thinkAt -= dt;
    if (bot.thinkAt <= 0) {
      bot.thinkAt = THINK_EVERY + random() * 0.05;
      think(bot, time, random);
    }
    bot.bloom = Math.max(0, bot.bloom - dt * BLOOM[bot.weaponKey].recovery);
    if (!bot.bloom) bot.shots = 0;
    if (bot.state !== 'defuse') bot.defuseProgress = 0;
    if (bot.state !== 'plant') bot.plantProgress = 0;
    bot.cooldown = Math.max(0, bot.cooldown - dt);

    // Aiming: face the target when fighting, the route when moving.
    let moveX = 0;
    let moveZ = 0;
    let speed = BOT_SPEED_WALK;
    if (bot.state === 'plant' || bot.state === 'defuse') {
      moveX = 0;
      moveZ = 0;
      bot.body.crouching = true;
      if (bot.state === 'plant') {
        bot.plantProgress += dt;
        if (bot.plantProgress >= 3.5) hooks.onPlantBot(bot);
      } else {
        bot.defuseProgress += dt;
        if (bot.defuseProgress >= (bot.kit ? 2.5 : 5)) hooks.onDefuse(bot);
      }
    } else if (bot.target) {
      const t = bot.target.pos;
      const dx = t.x - bot.body.position.x;
      const dz = t.z - bot.body.position.z;
      bot.body.yaw = Math.atan2(-dx, -dz);
      // Strafe a little while fighting so bots are not turrets.
      const strafe = Math.sin(time * 0.9 + bot.id.charCodeAt(4)) * 0.4;
      moveX = Math.cos(bot.body.yaw) * strafe;
      moveZ = -Math.sin(bot.body.yaw) * strafe;
      speed = BOT_SPEED_WALK * 0.6;
      bot.body.crouching = bot.targetVisible > 1.2 && random() < 0.3;
    } else if (bot.state === 'route' && bot.route.length) {
      const wp = bot.route[bot.routeIdx];
      const dx = wp.x - bot.body.position.x;
      const dz = wp.z - bot.body.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.9) {
        bot.routeIdx += 1;
        if (bot.routeIdx >= bot.route.length) {
          bot.state = bot.team === 'def' ? 'hold' : 'hold';
          bot.holdUntil = time + 4 + random() * 4;
        }
      } else {
        moveX = dx / dist;
        moveZ = dz / dist;
        bot.body.yaw = Math.atan2(-dx, -dz);
        speed = bot.plan === 'mid' ? BOT_SPEED_WALK : BOT_SPEED_PUSH;
      }
    } else if (bot.state === 'investigate' && bot.holdPos) {
      const dx = bot.holdPos.x - bot.body.position.x;
      const dz = bot.holdPos.z - bot.body.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 1.2) {
        bot.state = 'hold';
        bot.holdUntil = time + 2 + random() * 3;
      } else {
        moveX = dx / dist;
        moveZ = dz / dist;
        bot.body.yaw = Math.atan2(-dx, -dz);
      }
    } else if (bot.state === 'hold') {
      if (bot.holdUntil && time > bot.holdUntil) {
        // Rotate the hold: peek the next lane.
        bot.body.yaw += (random() - 0.5) * 1.6;
        bot.holdUntil = time + 3 + random() * 3;
      }
    }

    bot.body.velocity.x = moveX * speed;
    bot.body.velocity.z = moveZ * speed;
    slideMove(world.colliders, bot.body, dt, speed, bot.body.crouching, false);

    // Firing: bursts with a reaction delay once a target is held. A bot must
    // watch a target for half a second before its first shot, and its hit
    // chance falls off hard with range and target speed — cross-map spray
    // should be noise, not a meat grinder.
    if (bot.target && bot.targetVisible > DIFFICULTY[bot.difficulty].reaction && bot.cooldown === 0 && bot.reloadLeft <= 0) {
      bot.aimError = Math.max(0.008, 0.075 * DIFFICULTY[bot.difficulty].error - bot.targetVisible * 0.02);
      const dist = bot.target.pos.distanceTo(eyePos(bot, _v1));
      const moving = bot.target.kind === 'player' ? hooks.playerSpeed() : 2;
      const hitChance = Math.max(0.08, 0.38 - dist * 0.012 - moving * 0.03);
      if (bot.burstLeft <= 0) {
        bot.burstLeft = 2 + Math.floor(random() * 3);
        bot.burstGap = 0.35 + random() * 0.4; // reaction + trigger pause
      }
      bot.burstGap -= dt;
      if (bot.burstGap <= 0 && bot.burstLeft > 0) {
        bot.burstLeft -= 1;
        bot.burstGap = 0.11;
        bot.cooldown = WEAPONS[bot.weaponKey].gap;
        fire(bot, hitChance, dist);
      }
    }
    if (bot.reloadLeft > 0) {
      bot.reloadLeft -= dt;
      if (bot.reloadLeft <= 0) {
        const take = Math.min(WEAPONS[bot.weaponKey].mag - bot.mag, bot.reserve);
        bot.mag += take;
        bot.reserve -= take;
      }
    }

    // Sync the mesh to the body.
    bot.mesh.position.set(bot.body.position.x, bot.body.position.y, bot.body.position.z);
    bot.mesh.rotation.y = bot.body.yaw;
    const crouchScale = bot.body.crouching ? 0.82 : 1;
    bot.mesh.scale.y += (crouchScale - bot.mesh.scale.y) * Math.min(1, dt * 10);
  }

  function fire(bot, hitChance, dist) {
    if (bot.mag <= 0) {
      if (bot.reserve > 0) bot.reloadLeft = WEAPONS[bot.weaponKey].reload;
      return;
    }
    bot.mag -= 1;
    const from = eyePos(bot, _v1).clone();
    from.y -= 0.15;
    const to = bot.target.pos.clone();
    // Muzzle flash + tracer from the bot's gun to the aim point.
    hooks.tracer(from, to, bot.team === 'atk' ? PALETTE.amber : PALETTE.teal);
    hooks.sound('enemyShot', dist);
    const aim = to.clone().sub(from).normalize();
    const spread = bot.aimError + bot.bloom;
    const recoil = recoilFor(bot.weaponKey, bot.shots++);
    aim.x += (Math.random() - .5) * spread + recoil[1];
    aim.y += (Math.random() - .5) * spread + recoil[0] * .3;
    const bloom = BLOOM[bot.weaponKey];
    bot.bloom = Math.min(bloom.max, bot.bloom + bloom.shot);
    const ray = new THREE.Ray(from,aim.normalize());
    const targetBody=bot.target.kind==='player'?hooks.playerBody():bot.target.ref.body;
    const hit=intersectBody(ray,targetBody);
    if(hit && !obscured(from,to) && hasLineOfSight(shootables,from,to)) {
      const dmg=WEAPONS[bot.weaponKey].damage*hit.multiplier;
      if(bot.target.kind==='player') hooks.damagePlayer(dmg,hit.part==='head',bot);
      else hooks.damageBot(bot.target.ref,dmg,hit.part,bot);
    }
    hooks.gunshot?.(bot);
    hearShot(bot.body.position,bot.team);

  }

  // A bot hears a shot: the nearest two bots on each side drift toward it.
  function hearShot(pos, shooterTeam, range=HEAR_RANGE) {
    let heard = 0;
    for (const bot of bots) {
      if (!bot.alive || bot.team === shooterTeam || bot.target) continue;
      const d = Math.hypot(bot.body.position.x - pos.x, bot.body.position.z - pos.z);
      if (d < range && heard < 2) {
        bot.hearPos = { x: pos.x, z: pos.z };
        heard += 1;
      }
    }
  }

  function damage(bot, amount, part) {
    if (!bot.alive) return false;
    const dmg = armoredDamage(bot,amount,part);
    bot.health -= dmg;
    if (bot.health <= 0) {
      bot.health = 0;
      bot.alive = false;
      bot.mesh.rotation.x = -Math.PI / 2;
      bot.mesh.position.y = 0.25;
      return true;
    }
    return false;
  }

  function aliveCount(team) {
    let n = 0;
    for (const bot of bots) if (bot.alive && bot.team === team) n += 1;
    return n;
  }

  function step(dt, time, random) {
    for (const bot of bots) stepBot(bot, dt, time, random);
  }

  function hitMeshes() {
    const out = [];
    for (const bot of bots) {
      if (!bot.alive) continue;
      out.push(bot.bodyMesh, bot.headMesh, bot.limbMesh);
    }
    return out;
  }

  return {
    bots,
    reset,
    step,
    damage,
    hearShot,
    aliveCount,
    hitMeshes,
    carrier() {
      return bots.find((b) => b.hasBomb && b.alive) || null;
    },
  };
}
