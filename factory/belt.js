import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';
import { ALL_ITEMS } from '../constants.js';

const BELT_SPEEDS = { belt_basic: 1.5, belt_fast: 4.5, belt_ultra: 12.0 };
const ITEM_SIZE = 0.18;
let _beltId = 0;

class BeltItem {
  constructor(name, scene) {
    this.name = name;
    this.progress = 0; // 0..1 along belt
    const itemDef = Object.values(ALL_ITEMS).find(i => i.name === name);
    const color = itemDef ? itemDef.color : 0xffffff;
    const geo = new THREE.BoxGeometry(ITEM_SIZE, ITEM_SIZE, ITEM_SIZE);
    const mat = new THREE.MeshBasicMaterial({ color });
    this.mesh = new THREE.Mesh(geo, mat);
    scene.add(this.mesh);
  }

  dispose(scene) {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

export class Belt {
  constructor(fromBuilding, toBuilding, scene, tier = 'belt_basic') {
    this.id = ++_beltId;
    this.from = fromBuilding;
    this.to = toBuilding;
    this.tier = tier;
    this.scene = scene;
    this.speed = BELT_SPEEDS[tier] || 1.5;
    this.items = [];
    this._buildMesh();
  }

  // Rebuild the tube geometry/curve from the current building positions —
  // called after one of the connected buildings is moved.
  rebuildMesh() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this._buildMesh();
  }

  _buildMesh() {
    const start = this.from.position.clone();
    const end = this.to.position.clone();
    const mid = start.clone().add(end).multiplyScalar(0.5);
    const dir = end.clone().sub(start);
    const len = dir.length();

    // Tube along straight line between buildings
    const points = [];
    const steps = Math.max(2, Math.ceil(len / 3));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const p = start.clone().lerp(end, t);
      // Arc slightly above surface
      const r = p.length();
      p.normalize().multiplyScalar(r + 0.5 * Math.sin(t * Math.PI));
      points.push(p);
    }
    const curve = new THREE.CatmullRomCurve3(points);
    const tubeGeo = new THREE.TubeGeometry(curve, steps * 3, 0.12, 6, false);
    const tubeMat = new THREE.MeshLambertMaterial({ color: 0x334466 });
    this.mesh = new THREE.Mesh(tubeGeo, tubeMat);
    this.scene.add(this.mesh);
    this._curve = curve;
    this._curveLen = len;
  }

  update(dt) {
    const advanceDist = this.speed * dt;
    const advanceNorm = advanceDist / Math.max(1, this._curveLen);

    // Move items along belt
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      // Blocked by item ahead
      const ahead = this.items[i + 1];
      const gap = ahead ? ahead.progress - item.progress : 1;
      const minGap = 0.05;
      if (gap > minGap + 0.001) {
        item.progress = Math.min(item.progress + advanceNorm, ahead ? ahead.progress - minGap : 1.0);
      }
      if (item.progress >= 1.0) {
        // Deliver
        const ok = this.to.receiveItem(item.name, 1);
        if (ok) {
          item.dispose(this.scene);
          this.items.splice(i, 1);
        } else {
          item.progress = 1.0 - 0.001; // stay at end, blocked
        }
      }
      // Update visual position
      const pos = this._curve.getPointAt(Math.min(0.9999, item.progress));
      item.mesh.position.copy(pos);
    }

    // Pull from source building
    if (this.items.length === 0 || this.items[0].progress > 0.12) {
      const outItem = this.from.getFirstOutput();
      if (outItem) {
        const took = this.from.takeOutput(outItem);
        if (took) {
          const newItem = new BeltItem(outItem, this.scene);
          newItem.progress = 0;
          this.items.unshift(newItem);
        }
      }
    }
  }

  setTier(tier) {
    this.tier = tier;
    this.speed = BELT_SPEEDS[tier] || 1.5;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    for (const item of this.items) item.dispose(this.scene);
    this.items = [];
  }
}
