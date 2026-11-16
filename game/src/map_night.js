import * as THREE from 'three';

// Nightfall shares the yard perimeter but replaces the mid building with a
// staggered checkpoint and opens a western maintenance entrance to A.
export function applyNightfall(scene, world, group) {
  scene.background = new THREE.Color(0x060d21);
  scene.fog = new THREE.Fog(0x101c32, 28, 85);
  for (const object of [...scene.children]) {
    if (object.isDirectionalLight) {
      object.color.set(0x728fce);
      object.intensity = 0.35;
    }
    if (object.isHemisphereLight) object.intensity = 0.65;
    if (object.isMesh && object.geometry.type === 'CircleGeometry') object.visible = false;
  }
  function remove(mesh) {
    const bounds = new THREE.Box3().setFromObject(mesh);
    const index = world.colliders.findIndex(b => b.min.distanceTo(bounds.min) < 0.02 && b.max.distanceTo(bounds.max) < 0.02);
    if (index >= 0) world.colliders.splice(index, 1);
    const shot = world.shootables.indexOf(mesh);
    if (shot >= 0) world.shootables.splice(shot, 1);
    group.remove(mesh);
    mesh.geometry.dispose();
  }
  group.updateMatrixWorld(true);
  for (const mesh of [...group.children]) {
    if (!mesh.isMesh || mesh.geometry.type !== 'BoxGeometry') continue;
    const p = mesh.position;
    if ((Math.abs(p.x) < 11 && Math.abs(p.z) < 5) || (p.x === -29 && p.z === -12)) remove(mesh);
  }
  const steel = new THREE.MeshStandardMaterial({color:0x334357,roughness:0.7});
  function cover(x,z,w,d,h=2.4) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w,h,d),steel);
    mesh.position.set(x,h/2,z);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    world.shootables.push(mesh);
    world.colliders.push(new THREE.Box3(new THREE.Vector3(x-w/2,0,z-d/2),new THREE.Vector3(x+w/2,h,z+d/2)));
  }
  cover(-5,1,5,2);
  cover(5,-2,5,2);
  cover(-8,-3,2,3);
  cover(8,3,2,3);
  cover(-32,-4,2,5);
  cover(-32,-19,2,4);
  // Routes follow clear pavement around the new checkpoint.
  const nodes = world.waypoints;
  nodes.midS.x = 0;
  nodes.midN.x = 0;
  nodes.aFlankSouth = {x:-32,z:10,links:['sWest','aFlankGate']};
  nodes.aFlankGate = {x:-32,z:-12,links:['aFlankSouth','aSite']};
  nodes.sWest.links.push('aFlankSouth');
  nodes.aSite.links.push('aFlankGate');
  for (const [x,z] of [[-25,8],[25,8],[-25,-22],[25,-22],[0,12],[0,-15]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.12,.18,7,8),steel);
    pole.position.set(x,3.5,z);
    group.add(pole);
    const lamp = new THREE.SpotLight(0xc7e5ff,85,40,Math.PI/3,0.6,1.3);
    lamp.position.set(x,7,z);
    lamp.target.position.set(x*.65,0,z*.65);
    scene.add(lamp, lamp.target);
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(.8,.15,.5),new THREE.MeshBasicMaterial({color:0xe1f5ff}));
    bulb.position.copy(lamp.position);
    group.add(bulb);
  }
  addNightInfrastructure(scene, world, group);
  preferNightFlanks(world);
  const errors = validateNightRoutes(world);
  if (errors.length) throw new Error(errors.join('; '));
  world.sites.A.name = 'A — Night Maintenance';
  world.sites.B.name = 'B — Floodlight Array';
}

// Map validation is shared by the runtime and offline checks. A disconnected
// waypoint is a gameplay defect: the last defender must always reach both sites.
export function validateNightRoutes(world) {
  const graph = world.waypoints;
  const errors = [];
  for (const [id, node] of Object.entries(graph)) {
    for (const next of node.links) {
      if (!graph[next]) errors.push(`${id}: missing ${next}`);
      else if (!graph[next].links.includes(id)) errors.push(`${id}: one-way ${next}`);
    }
  }
  for (const start of ['sSpawn', 'nSpawn']) {
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const id = queue.shift();
      for (const link of graph[id].links) {
        if (seen.has(link)) continue;
        seen.add(link);
        queue.push(link);
      }
    }
    for (const site of ['aSite', 'bSite']) {
      if (!seen.has(site)) errors.push(`${start} cannot reach ${site}`);
    }
  }
  return errors;
}

export function addNightInfrastructure(scene, world, group) {
  const materials = {
    concrete: new THREE.MeshStandardMaterial({color:0x293643,roughness:.95}),
    metal: new THREE.MeshStandardMaterial({color:0x607388,metalness:.6,roughness:.5}),
    glow: new THREE.MeshBasicMaterial({color:0x62d9ed}),
  };
  function obstacle(x, z, width, depth, height, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width,height,depth),material);
    mesh.position.set(x,height/2,z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    world.colliders.push(new THREE.Box3(
      new THREE.Vector3(x-width/2,0,z-depth/2),
      new THREE.Vector3(x+width/2,height,z+depth/2),
    ));
    world.shootables.push(mesh);
    return mesh;
  }
  // East perimeter access forms a second approach to the panel site. Cover
  // breaks the long lane without occupying any waypoint's walking corridor.
  obstacle(30,9,3,2,2.1,materials.metal);
  obstacle(34,-3,2,4,2.6,materials.concrete);
  obstacle(28,-10,2,2,1.2,materials.metal);
  obstacle(23,2,2,3,1.5,materials.concrete);
  const graph = world.waypoints;
  graph.bOuterSouth = {x:31,z:14,links:['sEast','bOuterMid']};
  graph.bOuterMid = {x:31,z:0,links:['bOuterSouth','bOuterNorth']};
  graph.bOuterNorth = {x:31,z:-12,links:['bOuterMid','bSite']};
  graph.sEast.links.push('bOuterSouth');
  graph.bSite.links.push('bOuterNorth');
  // Maintenance markings illuminate the flanks, while the central checkpoint
  // remains dark enough for flashes to matter. Strips are visual, never walls.
  for (const x of [-33,32]) {
    for (let z = -20; z <= 20; z += 5) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(.12,.02,1.8),materials.glow);
      strip.position.set(x,.03,z);
      group.add(strip);
    }
  }
  // Blocking the dead-end corners prevents bots from wedging behind the new
  // equipment when strafing. Each block leaves the service lanes four metres.
  obstacle(-34,-24,3,3,1.8,materials.concrete);
  obstacle(34,24,3,3,1.8,materials.concrete);
  const point = new THREE.PointLight(0x4eb6dc,9,18,1.8);
  point.position.set(-32,3,-12);
  scene.add(point);
  const east = new THREE.PointLight(0xefc98d,12,20,1.8);
  east.position.set(31,4,-10);
  scene.add(east);
}

// Choose between two equally valid flank routes by adjusting only links on the
// per-match graph. This gives night attacks access to the new approaches rather
// than leaving them as corridors only the human knows exist.
export function preferNightFlanks(world) {
  const graph = world.waypoints;
  graph.aHold.links.push('nSpawn');
  graph.bHold.links.push('nSpawn');
  graph.sWest.links = ['sSpawn','sMid','aFlankSouth','aApproach'];
  graph.sEast.links = ['sSpawn','sMid','bOuterSouth','bApproach'];
  // BFS resolves equal-length routes by link order. The outer entries also
  // offer a clean direct line from the side approach to the corresponding site.
  graph.aFlankSouth.links.push('aFlankGate');
  graph.aFlankSouth.links = [...new Set(graph.aFlankSouth.links)];
  graph.bOuterSouth.links.push('bOuterNorth');
  graph.bOuterNorth.links.push('bOuterSouth');
}
