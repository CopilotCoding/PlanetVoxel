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

    this._buildDirectionArrows();
  }

  // Small glowing chevrons laid along the belt, each oriented to point
  // toward `to` — a static visual cue for flow direction that's readable
  // even when no items are currently on the belt (e.g. a starved machine).
  _buildDirectionArrows() {
    if (this._arrows) {
      for (const a of this._arrows) {
        this.scene.remove(a);
        a.geometry.dispose();
        a.material.dispose();
      }
    }
    this._arrows = [];

    const arrowGeo = new THREE.ConeGeometry(0.12, 0.32, 4);
    const arrowMat = new THREE.MeshBasicMaterial({
      color: 0x66ccff,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    // One arrow roughly every 2 units of belt length, but never more than a
    // handful — long belts shouldn't spam the scene with cones.
    const count = Math.max(1, Math.min(8, Math.round(this._curveLen / 2)));
    for (let i = 1; i <= count; i++) {
      const t = i / (count + 1);
      const arrow = new THREE.Mesh(arrowGeo, arrowMat);
      this._arrows.push(arrow);
      this.scene.add(arrow);
    }
    this._positionArrows(0);
  }

  // Place each arrow along the curve at progress (baseT + index offset),
  // oriented along the curve's tangent (flow direction, from -> to) with its
  // "up" aligned to the local surface normal so it lies flat against the
  // belt like the items do.
  _positionArrows(scrollOffset) {
    const count = this._arrows.length;
    for (let i = 0; i < count; i++) {
      let t = (i + 1) / (count + 1) + scrollOffset;
      t = ((t % 1) + 1) % 1; // wrap into [0,1)
      const pos = this._curve.getPointAt(t);
      const tangent = this._curve.getTangentAt(t).normalize();
      const arrow = this._arrows[i];
      arrow.position.copy(pos).addScaledVector(pos.clone().normalize(), 0.18);
      // Cone's local +Y is its point; rotate it to align with the flow tangent.
      arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
    }
  }

  update(dt) {
    const advanceDist = this.speed * dt;
    const advanceNorm = advanceDist / Math.max(1, this._curveLen);

    // Slowly scroll the direction arrows along the belt (faster belts scroll
    // faster) so the indicator reads as "flow" rather than a static decal.
    this._arrowScroll = ((this._arrowScroll || 0) + advanceNorm * 0.5) % 1;
    this._positionArrows(this._arrowScroll);

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
          // `to` can't take it right now (buffer full / wrong type with no
          // outgoing belt of its own) and there's no way to lane-change
          // around it on a single-lane belt. Rather than freeze it here —
          // which would cascade into a permanent jam blocking every other
          // item type queued behind it — bounce it back into the source's
          // output buffer. The belt is now fully clear; the source will
          // re-offer it (possibly down a different belt) once something can
          // accept it.
          this.from.outputBuffer[item.name] = (this.from.outputBuffer[item.name] || 0) + 1;
          item.dispose(this.scene);
          this.items.splice(i, 1);
        }
      }
      // Update visual position
      const pos = this._curve.getPointAt(Math.min(0.9999, item.progress));
      item.mesh.position.copy(pos);
    }

  }

  // True if this belt currently has room to accept a new item at its pickup
  // end. Pulling itself is done separately via tryPull(), called by Factory
  // in a round-robin pass across all of a source building's outgoing belts —
  // calling getFirstOutput()/takeOutput() directly from update() let whichever
  // belt's update() ran first each frame always win the race for a source's
  // (often single-item) output buffer, permanently starving its sibling belts.
  canPull() {
    return this.items.length === 0 || this.items[0].progress > 0.12;
  }

  // Attempt to pull one item from `this.from` onto this belt. Returns true if
  // an item was actually pulled (so the caller can stop offering this source's
  // output to further belts this frame).
  tryPull() {
    if (!this.canPull()) return false;
    const outItem = this.from.getFirstOutput(this.to);
    if (!outItem) return false;
    const took = this.from.takeOutput(outItem);
    if (!took) return false;
    const newItem = new BeltItem(outItem, this.scene);
    newItem.progress = 0;
    this.items.unshift(newItem);
    return true;
  }

  setTier(tier) {
    this.tier = tier;
    this.speed = BELT_SPEEDS[tier] || 1.5;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    if (this._arrows) {
      for (const a of this._arrows) {
        this.scene.remove(a);
        a.material.dispose();
      }
      // Geometry is shared across all arrows on this belt — dispose once.
      if (this._arrows.length > 0) this._arrows[0].geometry.dispose();
      this._arrows = [];
    }
    for (const item of this.items) item.dispose(this.scene);
    this.items = [];
  }
}
