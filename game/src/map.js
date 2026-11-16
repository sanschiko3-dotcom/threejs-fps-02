// SOLSTICE YARD — the map. A solar power station at dusk: Strikers spawn south,
// Wardens spawn north, site A is the inverter hall in the west, site B is the panel
// field in the east, and mid is a service road past the control building. Three
// lanes (A, mid, B) with crates, containers and panel rows for cover, so every
// sightline has a corner to play around. Colliders are plain AABBs; the waypoint
// graph is what the bots walk. All materials are shared and created once.
import * as THREE from 'three';
import { applyNightfall } from './map_night.js';
import { PALETTE } from './palette.js';

const SITES = {
  A: { x: -22, z: -12, r: 4.5, name: 'A — Inverter Hall' },
  B: { x: 20, z: -12, r: 4.5, name: 'B — Panel Field' },
};

const SPAWNS = {
  atk: [
    { x: -4, z: 22, yaw: 0 }, { x: -1.5, z: 23, yaw: 0 }, { x: 1.5, z: 23, yaw: 0 },
    { x: 4, z: 22, yaw: 0 }, { x: 0, z: 20, yaw: 0 },
  ],
  def: [
    { x: -4, z: -22, yaw: Math.PI }, { x: -1.5, z: -23, yaw: Math.PI },
    { x: 1.5, z: -23, yaw: Math.PI }, { x: 4, z: -22, yaw: Math.PI },
    { x: 0, z: -20, yaw: Math.PI },
  ],
};

// Waypoint graph: id -> { x, z, links }. Bots BFS across it.
const WAYPOINTS = {
  sSpawn: { x: 0, z: 21, links: ['sMid', 'sWest', 'sEast'] },
  sMid: { x: 0, z: 10, links: ['sSpawn', 'midS', 'sWest', 'sEast'] },
  sWest: { x: -12, z: 14, links: ['sSpawn', 'sMid', 'aApproach'] },
  sEast: { x: 12, z: 14, links: ['sSpawn', 'sMid', 'bApproach'] },
  midS: { x: 0, z: 4, links: ['sMid', 'midN'] },
  midN: { x: 0, z: -6, links: ['midS', 'aApproach', 'bApproach', 'nMid'] },
  aApproach: { x: -13, z: -8, links: ['midN', 'sWest', 'aSite', 'aHold'] },
  bApproach: { x: 12, z: -10, links: ['midN', 'sEast', 'bSite', 'bHold'] },
  aSite: { x: -22, z: -12, links: ['aApproach', 'aHold'] },
  bSite: { x: 20, z: -10.2, links: ['bApproach', 'bHold'] },
  aHold: { x: -16, z: -16, links: ['aApproach', 'aSite', 'nMid'] },
  bHold: { x: 12, z: -16, links: ['bApproach', 'bSite', 'nMid'] },
  nMid: { x: 0, z: -12, links: ['midN', 'aHold', 'bHold', 'nSpawn'] },
  nSpawn: { x: 0, z: -21, links: ['nMid', 'aHold', 'bHold'] },
};

export function createWorld(scene, variant = 'solstice') {
  const colliders = [];
  const shootables = [];
  const mats = {
    ground: new THREE.MeshStandardMaterial({ color: PALETTE.ground, roughness: 1, metalness: 0 }),
    concrete: new THREE.MeshStandardMaterial({ color: PALETTE.concrete, roughness: 0.9, metalness: 0 }),
    dark: new THREE.MeshStandardMaterial({ color: PALETTE.concreteDark, roughness: 0.95, metalness: 0 }),
    panel: new THREE.MeshStandardMaterial({ color: PALETTE.panel, roughness: 0.25, metalness: 0.7 }),
    panelEdge: new THREE.MeshStandardMaterial({ color: PALETTE.panelEdge, roughness: 0.5, metalness: 0.6 }),
    amber: new THREE.MeshStandardMaterial({ color: PALETTE.amber, roughness: 0.6, metalness: 0.2, emissive: PALETTE.amber, emissiveIntensity: 0.25 }),
    teal: new THREE.MeshStandardMaterial({ color: PALETTE.teal, roughness: 0.6, metalness: 0.2, emissive: PALETTE.teal, emissiveIntensity: 0.25 }),
    hazard: new THREE.MeshStandardMaterial({ color: PALETTE.hazard, roughness: 0.6, metalness: 0.1, emissive: PALETTE.hazard, emissiveIntensity: 0.4 }),
    crate: new THREE.MeshStandardMaterial({ color: 0x7a6a4a, roughness: 0.85, metalness: 0.05 }),
    container: new THREE.MeshStandardMaterial({ color: 0x5d6b73, roughness: 0.7, metalness: 0.35 }),
  };

  const group = new THREE.Group();
  scene.add(group);

  function box(x, y, z, w, h, d, mat, opts = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    if (opts.ry) mesh.rotation.y = opts.ry;
    if (opts.rx) mesh.rotation.x = opts.rx;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (!opts.noCollide) {
      const half = new THREE.Vector3(w / 2, h / 2, d / 2);
      const center = new THREE.Vector3(x, y, z);
      // Rotated boxes get an axis-aligned bound; panels and crates use small angles only.
      if (opts.ry || opts.rx) {
        const c = Math.abs(Math.cos(opts.ry || 0));
        const s = Math.abs(Math.sin(opts.ry || 0));
        half.set((w * c + d * s) / 2, h / 2, (w * s + d * c) / 2);
      }
      colliders.push(new THREE.Box3(center.clone().sub(half), center.clone().add(half)));
    }
    if (opts.shootable !== false) shootables.push(mesh);
    return mesh;
  }

  // Ground + perimeter.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(72, 54), mats.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  colliders.push(new THREE.Box3(new THREE.Vector3(-36, -0.5, -27), new THREE.Vector3(36, 0, 27)));
  box(0, 2, -27.5, 73, 4, 1, mats.concrete);
  box(0, 2, 27.5, 73, 4, 1, mats.concrete);
  box(-36.5, 2, 0, 1, 4, 56, mats.concrete);
  box(36.5, 2, 0, 1, 4, 56, mats.concrete);

  // Control building, mid: two rooms with a doorway each side so mid is never a
  // single choke. The north and south walls leave a 2.4 m gap at x = -1.2..1.2.
  box(-7.5, 1.75, 0, 5, 3.5, 8, mats.concrete);
  box(7.5, 1.75, 0, 5, 3.5, 8, mats.concrete);
  box(-5.6, 1.75, -4.5, 8.8, 3.5, 1, mats.dark);
  box(5.6, 1.75, -4.5, 8.8, 3.5, 1, mats.dark);
  box(-5.6, 1.75, 4.5, 8.8, 3.5, 1, mats.dark);
  box(5.6, 1.75, 4.5, 8.8, 3.5, 1, mats.dark);
  box(0, 3.1, 0, 20, 0.8, 8, mats.dark); // lintel over the doorways
  box(0, 3.9, 0, 20, 0.4, 9, mats.dark); // roof slab

  // Site A — inverter hall (west). Open front, two big inverter cabinets inside.
  box(-29, 2, -12, 1, 4, 12, mats.concrete);
  box(-22, 2, -18.5, 15, 4, 1, mats.concrete);
  box(-22, 2, -5.5, 15, 4, 1, mats.concrete);
  box(-22, 4.2, -12, 15, 0.5, 13, mats.dark);
  box(-26, 1.1, -15, 3, 2.2, 1.6, mats.panelEdge);
  box(-26, 1.1, -9, 3, 2.2, 1.6, mats.panelEdge);
  box(-18.5, 0.8, -15.5, 2, 1.6, 2, mats.crate);
  box(-18.5, 0.8, -8.5, 2, 1.6, 2, mats.crate);

  // Site B — panel field (east). Tilted panel rows are the cover; a low service
  // hut anchors the corner.
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      box(15 + col * 4.2, 0.9, -17 + row * 4.5, 3.6, 0.18, 2.4, mats.panel, { rx: -0.42 });
      box(15 + col * 4.2, 0.45, -17 + row * 4.5, 0.25, 0.9, 0.25, mats.panelEdge);
    }
  }
  box(26, 1.4, -17, 4, 2.8, 4, mats.container);
  box(14, 0.7, -8, 3, 1.4, 1.4, mats.crate);

  // Mid cover: containers and crate stacks on the service road.
  box(-6, 1.3, 8, 4.5, 2.6, 2.2, mats.container, { ry: 0.12 });
  box(6, 1.3, -3, 4.5, 2.6, 2.2, mats.container, { ry: -0.1 });
  box(-8, 0.7, -10, 2, 1.4, 2, mats.crate);
  box(9, 0.7, 12, 2, 1.4, 2, mats.crate);
  box(-3, 0.7, 16, 2, 1.4, 2, mats.crate);
  box(3, 1.4, -16, 2, 2.8, 2, mats.crate);

  // Site markers: a glowing floor ring + a floating beacon light at each site.
  const siteRings = {};
  const siteLights = {};
  for (const key of ['A', 'B']) {
    const site = SITES[key];
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.r - 0.25, site.r, 40),
      new THREE.MeshBasicMaterial({ color: key === 'A' ? PALETTE.amber : PALETTE.teal, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, 0.02, site.z);
    group.add(ring);
    siteRings[key] = ring;
    const light = new THREE.PointLight(key === 'A' ? PALETTE.amber : PALETTE.teal, 6, 12);
    light.position.set(site.x, 3.2, site.z);
    group.add(light);
    siteLights[key] = light;
  }

  // Dusk lighting: low amber sun from the west, cool indigo fill from above.
  const sun = new THREE.DirectionalLight(PALETTE.sun, 2.9);
  sun.position.set(-40, 14, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.025;
  scene.add(sun);
  // Thin emissive strips sit above each site without changing collision geometry.
  for (const site of Object.values(SITES)) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(site.r, 0.025, 6, 48),
      new THREE.MeshStandardMaterial({color:0xffbf65,emissive:0xff9d32,emissiveIntensity:2})
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(site.x,0.035,site.z);
    scene.add(ring);
    const beacon = new THREE.PointLight(0xffae52,8,9);
    beacon.position.set(site.x,2.5,site.z);
    scene.add(beacon);
  }

  scene.add(new THREE.HemisphereLight(0x9a8fd8, 0x3a3026, 1.05));

  // Sun disc low on the western horizon, so the sky reads at a glance.
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(3.2, 32),
    new THREE.MeshBasicMaterial({ color: PALETTE.sun, fog: false }),
  );
  disc.position.set(-70, 9, -6);
  disc.lookAt(0, 2, 0);
  scene.add(disc);

  // Bomb-site beacons pulse; called once a frame with the elapsed time.
  let pulse = 0;
  function update(dt, bombPlantedAt) {
    pulse += dt;
    const glow = 0.4 + 0.25 * Math.sin(pulse * 2.4);
    siteRings.A.material.opacity = glow;
    siteRings.B.material.opacity = glow;
    if (bombPlantedAt) {
      siteLights[bombPlantedAt].intensity = 10 + 8 * Math.sin(pulse * 9);
    }
  }

  const world = {
    colliders,
    shootables,
    sites: SITES,
    spawns: SPAWNS,
    waypoints: WAYPOINTS,
    update,
    name: variant,
  };
  if (variant === 'nightfall') applyNightfall(scene, world, group);
  return world;
}

// Breadth-first route across the waypoint graph. Returns an array of {x,z}
// waypoints from `from` to `to` (excluding the start node). Small graph, no heap.
export function findRoute(waypoints, fromId, toId) {
  if (fromId === toId) return [waypoints[toId]];
  const prev = { [fromId]: null };
  const queue = [fromId];
  while (queue.length) {
    const current = queue.shift();
    for (const next of waypoints[current].links) {
      if (prev[next] !== undefined) continue;
      prev[next] = current;
      if (next === toId) {
        const path = [];
        let node = next;
        while (node !== fromId) {
          path.unshift(waypoints[node]);
          node = prev[node];
        }
        return path;
      }
      queue.push(next);
    }
  }
  return [waypoints[toId]];
}

export function nearestWaypoint(waypoints, x, z) {
  let best = null;
  let bestD = Infinity;
  for (const id of Object.keys(waypoints)) {
    const w = waypoints[id];
    const d = (w.x - x) ** 2 + (w.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}
