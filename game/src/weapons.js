// Weapons: four guns and a grenade, each with its own damage, fire rate, spread,
// recoil and price, so the buy menu is a real choice and not a reskin. A weapon
// is data (WEAPONS) plus a small state machine (createWeaponSet) that owns the
// view model, the magazine and the reload timer. main.js owns the ray and damage.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    name: 'P9 Sidearm', price: 0, damage: 26, headMult: 4, mag: 12, reserve: 48,
    gap: 0.16, reload: 1.4, auto: false, spreadStill: 0.003, spreadMove: 0.02,
    speed: 0, range: 60,
  },
  smg: {
    name: 'Hornet SMG', price: 1500, damage: 22, headMult: 4, mag: 28, reserve: 112,
    gap: 0.075, reload: 1.7, auto: true, spreadStill: 0.005, spreadMove: 0.03,
    speed: 0, range: 55,
  },
  rifle: {
    name: 'VK-47 Rifle', price: 2700, damage: 34, headMult: 4, mag: 30, reserve: 90,
    gap: 0.096, reload: 1.9, auto: true, spreadStill: 0.0022, spreadMove: 0.028,
    speed: 0, range: 80,
  },
  sniper: {
    name: 'Longbow DMR', price: 4750, damage: 88, headMult: 4, mag: 5, reserve: 15,
    gap: 0.9, reload: 2.6, auto: false, spreadStill: 0.0004, spreadMove: 0.05,
    speed: 0, range: 120,
  },
};

export const GRENADE = { name: 'HE Grenade', price: 300, damage: 95, radius: 6.5, fuse: 1.1 };
export const ARMOR = { name: 'Kevlar Vest', price: 650, absorb: 0.5 };

const BODY_COLORS = {
  pistol: 0x9a938a,
  smg: 0x4a5560,
  rifle: 0x2e2a26,
  sniper: 0x3d4a35,
};

// Build a boxy view model for one weapon key. Kept deliberately chunky: the
// silhouette has to read at a glance in a 1280-wide frame.
function buildViewModel(key) {
  const color = new THREE.MeshStandardMaterial({ color: BODY_COLORS[key], roughness: 0.55, metalness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x17150f, roughness: 0.7, metalness: 0.2 });
  const model = new THREE.Group();
  if (key === 'pistol') {
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.3), color);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.12, 0.07), dark);
    grip.position.set(0, -0.07, 0.1);
    model.add(slide, grip);
    model.position.set(0.2, -0.19, -0.36);
  } else if (key === 'smg') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.42), color);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.06), dark);
    mag.position.set(0, -0.1, -0.05);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.18), dark);
    stock.position.set(0, -0.01, 0.28);
    model.add(body, mag, stock);
    model.position.set(0.22, -0.2, -0.42);
  } else if (key === 'sniper') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.62), color);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 10), dark);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.07, -0.05);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.3), dark);
    barrel.position.set(0, 0.01, -0.42);
    model.add(body, scope, barrel);
    model.position.set(0.22, -0.21, -0.44);
  } else {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.42), color);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.4), dark);
    barrel.position.set(0, 0.025, -0.38);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), dark);
    stock.position.set(0, -0.02, 0.3);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.08), dark);
    sight.position.set(0, 0.075, -0.1);
    model.add(receiver, barrel, stock, sight);
    model.position.set(0.24, -0.2, -0.42);
  }
  return model;
}

export function createWeaponSet(camera) {
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: PALETTE.accent, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(PALETTE.accent, 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const models = {};
  let currentModel = null;
  const state = {
    key: 'rifle',
    mag: WEAPONS.rifle.mag,
    reserve: WEAPONS.rifle.reserve,
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
    grenades: 0,
  };

  function equip(key) {
    if (currentModel) camera.remove(currentModel);
    if (!models[key]) models[key] = buildViewModel(key);
    currentModel = models[key];
    camera.add(currentModel);
    state.key = key;
    state.mag = WEAPONS[key].mag;
    state.reserve = WEAPONS[key].reserve;
    state.cooldown = 0;
    state.reloadLeft = 0;
    state.flash = 0;
    state.kick = 0;
  }

  function step(dt) {
    const def = WEAPONS[state.key];
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    if (currentModel) {
      currentModel.position.z = -0.42 + state.kick;
      currentModel.rotation.x = state.kick * 2.2;
      if (state.reloadLeft > 0) {
        currentModel.rotation.x = -0.55 * Math.min(1, (def.reload - state.reloadLeft) * 2);
      }
    }
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      if (state.reloadLeft === 0) {
        const need = def.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  equip('rifle');
  return {
    state,
    step,
    equip,
    def() { return WEAPONS[state.key]; },
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = WEAPONS[state.key].gap;
      state.flash = 0.06;
      state.kick = 0.055;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      const def = WEAPONS[state.key];
      if (state.reloadLeft > 0 || state.mag === def.mag || state.reserve === 0) return;
      state.reloadLeft = def.reload;
    },
    spread(speed) {
      const def = WEAPONS[state.key];
      return def.spreadStill + Math.min(1, speed / 5.4) * def.spreadMove;
    },
    refill() {
      const def = WEAPONS[state.key];
      state.mag = def.mag;
      state.reserve = def.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
  };
}
