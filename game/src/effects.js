// Visual effects, all pooled: tracers, muzzle sparks, hit sparks and the bomb
// explosion. Nothing is allocated while the game runs — every effect is a mesh
// taken from a fixed pool and returned when its life runs out.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACER_POOL = 14;
const SPARK_POOL = 10;

export function createEffects(scene) {
  const tracers = [];
  const tracerMat = new THREE.MeshBasicMaterial({ color: PALETTE.amber, transparent: true, opacity: 0.85 });
  for (let i = 0; i < TRACER_POOL; i += 1) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 1), tracerMat.clone());
    mesh.visible = false;
    scene.add(mesh);
    tracers.push({ mesh, life: 0 });
  }
  let tracerNext = 0;

  const sparks = [];
  for (let i = 0; i < SPARK_POOL; i += 1) {
    const points = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ color: PALETTE.amber, size: 0.09, transparent: true, opacity: 0.95 }),
    );
    points.visible = false;
    scene.add(points);
    sparks.push({ points, life: 0, vel: [] });
  }
  let sparkNext = 0;

  const explosion = new THREE.Mesh(
    new THREE.SphereGeometry(1, 20, 14),
    new THREE.MeshBasicMaterial({ color: PALETTE.hazard, transparent: true, opacity: 0 }),
  );
  explosion.visible = false;
  scene.add(explosion);
  const explosionLight = new THREE.PointLight(PALETTE.hazard, 0, 30);
  scene.add(explosionLight);
  let explosionLife = 0;

  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();

  function tracer(from, to) {
    const t = tracers[tracerNext];
    tracerNext = (tracerNext + 1) % TRACER_POOL;
    tmp.addVectors(from, to).multiplyScalar(0.5);
    t.mesh.position.copy(tmp);
    tmp2.subVectors(to, from);
    const len = tmp2.length() || 0.001;
    t.mesh.scale.set(1, 1, len);
    t.mesh.lookAt(to);
    t.mesh.visible = true;
    t.life = 0.09;
    t.mesh.material.opacity = 0.85;
  }

  function burst(at, color, count) {
    const s = sparks[sparkNext];
    sparkNext = (sparkNext + 1) % SPARK_POOL;
    const positions = new Float32Array(count * 3);
    s.vel = [];
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = at.x;
      positions[i * 3 + 1] = at.y;
      positions[i * 3 + 2] = at.z;
      s.vel.push(new THREE.Vector3(
        (Math.random() * 2 - 1) * 3, Math.random() * 3.5, (Math.random() * 2 - 1) * 3,
      ));
    }
    s.points.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    s.points.material.color.set(color);
    s.points.visible = true;
    s.life = 0.45;
  }

  function explode(at) {
    explosion.position.copy(at);
    explosion.visible = true;
    explosion.scale.setScalar(0.5);
    explosionLife = 0.8;
    explosionLight.position.copy(at).y += 1;
    explosionLight.intensity = 60;
  }

  function step(dt) {
    for (const t of tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, t.life / 0.09) * 0.85;
      if (t.life <= 0) t.mesh.visible = false;
    }
    for (const s of sparks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      const attr = s.points.geometry.getAttribute('position');
      for (let i = 0; i < s.vel.length; i += 1) {
        attr.array[i * 3] += s.vel[i].x * dt;
        attr.array[i * 3 + 1] += s.vel[i].y * dt;
        attr.array[i * 3 + 2] += s.vel[i].z * dt;
        s.vel[i].y -= 9 * dt;
      }
      attr.needsUpdate = true;
      s.points.material.opacity = Math.max(0, s.life / 0.45);
      if (s.life <= 0) s.points.visible = false;
    }
    if (explosionLife > 0) {
      explosionLife -= dt;
      const k = 1 - explosionLife / 0.8;
      explosion.scale.setScalar(0.5 + k * 9);
      explosion.material.opacity = Math.max(0, 0.85 * (1 - k));
      explosionLight.intensity = Math.max(0, 60 * (1 - k));
      if (explosionLife <= 0) {
        explosion.visible = false;
        explosionLight.intensity = 0;
      }
    }
  }

  return { tracer, burst, explode, step };
}
