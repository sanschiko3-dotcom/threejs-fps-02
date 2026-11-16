import * as THREE from 'three';
export const clouds = [];
export function obscured(a,b) { return clouds.some(c => { const d=new THREE.Vector3().subVectors(b,a); const t=THREE.MathUtils.clamp(new THREE.Vector3().subVectors(c.position,a).dot(d)/d.lengthSq(),0,1); return new THREE.Vector3().copy(a).addScaledVector(d,t).distanceTo(c.position)<3.8; }); }
export function createUtility(scene) {
 const flashes=[];
 return {
 throw(kind,position,actors) {
 if(kind==='smoke') { const mesh=new THREE.Mesh(new THREE.SphereGeometry(3.8,16,12),new THREE.MeshBasicMaterial({color:0xb4aaa0,transparent:true,opacity:0.94})); mesh.position.copy(position); mesh.position.y=1.8; scene.add(mesh); clouds.push({position:mesh.position,mesh,left:12}); }
 else for(const a of actors) { const delta=new THREE.Vector3().subVectors(position,a.position); const distance=delta.length(); if(distance>20)continue; const facing=new THREE.Vector3(-Math.sin(a.yaw),0,-Math.cos(a.yaw)); a.flash(Math.max(0,1-distance/20)*(0.25+0.75*Math.max(0,facing.dot(delta.normalize())))*4); }
 },
 step(dt) { for(let i=clouds.length-1;i>=0;i--)if((clouds[i].left-=dt)<=0){scene.remove(clouds[i].mesh);clouds[i].mesh.geometry.dispose();clouds[i].mesh.material.dispose();clouds.splice(i,1);} }
 };
}
