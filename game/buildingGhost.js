import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';

// Per-type half-heights so the ghost/placement sits fully above the surface
export const BUILDING_HALF_H = {
  extractor: 0.9, crusher: 0.7, smelter: 1.1, fabricator: 1.0,
  assembler: 1.1, storage: 0.5, terminal: 1.0, generator: 0.8,
  pylon: 1.5, sorter: 0.3,
};

export function getBuildingGeo(type) {
  switch (type) {
    case 'extractor':  return new THREE.CylinderGeometry(0.6, 0.9, 1.8, 6);
    case 'crusher':    return new THREE.BoxGeometry(1.4, 1.4, 1.4);
    case 'smelter':    return new THREE.CylinderGeometry(0.5, 0.8, 2.2, 8);
    case 'fabricator': return new THREE.OctahedronGeometry(1.0);
    case 'assembler':  return new THREE.DodecahedronGeometry(1.1);
    case 'storage':    return new THREE.BoxGeometry(1.6, 1.0, 1.6);
    case 'terminal':   return new THREE.BoxGeometry(1.0, 2.0, 0.3);
    case 'generator':  return new THREE.CylinderGeometry(0.7, 0.7, 1.6, 8);
    case 'pylon':      return new THREE.ConeGeometry(0.3, 3.0, 8);
    case 'sorter':     return new THREE.BoxGeometry(1.2, 0.6, 1.2);
    default:           return new THREE.BoxGeometry(1.2, 1.2, 1.2);
  }
}

// Manages the translucent "ghost" preview mesh shown while placing or moving
// a building. Holds its own materials and tracks the currently-added group
// so callers just call update()/clear().
export class BuildingGhost {
  constructor(scene) {
    this.scene = scene;
    this.group = null;
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x88aaff, transparent: true, opacity: 0.45, wireframe: false });
    this.ghostEdgeMat = new THREE.MeshBasicMaterial({ color: 0xaaccff, transparent: true, opacity: 0.8, wireframe: true });
  }

  clear() {
    if (this.group) { this.scene.remove(this.group); this.group = null; }
  }

  update(type, pos, normal, yaw) {
    this.clear();
    if (!type || !pos) return;
    const geo = getBuildingGeo(type);
    const mesh = new THREE.Mesh(geo, this.ghostMat);
    const wire = new THREE.Mesh(geo, this.ghostEdgeMat);
    this.group = new THREE.Group();
    this.group.add(mesh);
    this.group.add(wire);
    this.group.position.copy(pos);
    const worldUp = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(worldUp, normal);
    const qYaw = new THREE.Quaternion().setFromAxisAngle(normal, yaw);
    let orient = qYaw.multiply(q);
    if (type === 'extractor') {
      orient = orient.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI));
    }
    this.group.setRotationFromQuaternion(orient);
    this.scene.add(this.group);
  }
}
