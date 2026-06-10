import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';
import { BUILDING_DEFS, PLANET_RADIUS } from '../constants.js';
import { Building } from './structures.js';
import { Belt } from './belt.js';

const POWER_RANGE = 40;

export class Factory {
  constructor(scene, planet, economy, inventory, audio) {
    this.scene = scene;
    this.planet = planet;
    this.economy = economy;
    this.inventory = inventory;
    this.audio = audio;
    this.buildings = [];
    this.belts = [];
    this._pendingBeltFrom = null;
    this._ghostMesh = null;
  }

  update(dt) {
    // Build power grid: start from running generators, spread via proximity/pylons AND belt connections
    const activeGenerators = this.buildings.filter(b => b.type === 'generator' && b.status === 'running');

    // Proximity spread (generators + pylons)
    const poweredZones = activeGenerators.map(g => g.position.clone());
    for (const pylon of this.buildings.filter(b => b.type === 'pylon')) {
      for (const zone of [...poweredZones]) {
        if (pylon.position.distanceTo(zone) < POWER_RANGE) { poweredZones.push(pylon.position.clone()); break; }
      }
    }

    // Belt-graph spread: BFS from generators through all belt connections
    const beltPowered = new Set(activeGenerators);
    const queue = [...activeGenerators];
    while (queue.length) {
      const b = queue.shift();
      for (const belt of this.belts) {
        const neighbour = belt.from === b ? belt.to : belt.to === b ? belt.from : null;
        if (neighbour && !beltPowered.has(neighbour)) {
          beltPowered.add(neighbour);
          queue.push(neighbour);
        }
      }
    }

    for (const b of this.buildings) {
      if (b.type === 'smelter' || b.type === 'assembler') {
        const proximityPowered = poweredZones.some(z => b.position.distanceTo(z) < POWER_RANGE);
        b.setPowered(proximityPowered || beltPowered.has(b));
      }
      b.update(dt, this.economy, this.inventory);
    }

    for (const belt of this.belts) {
      belt.update(dt);
    }

    // Belt hum volume
    const runningBelts = this.belts.filter(b => b.items.length > 0).length;
    this.audio.setBeltHum(runningBelts);
  }

  placeBuilding(type, worldPos, normal, yaw = 0) {
    const def = BUILDING_DEFS[type];
    if (!def) return null;
    if (!this.economy.isBuildingUnlocked(type)) return null;
    if (!this.economy.spend(def.placeCost)) return null;

    const b = new Building(type, worldPos, normal, this.scene, this.planet, yaw);
    this.buildings.push(b);
    this.audio.playPlace();
    return b;
  }

  // Reconstructs a building when loading a save — bypasses unlock/cost checks
  // since the player already paid for it in the original playthrough.
  // worldPos/normal may be plain arrays (from JSON) or THREE.Vector3.
  placeBuildingFree(type, worldPos, normal, yaw = 0) {
    const def = BUILDING_DEFS[type];
    if (!def) return null;
    const pos = worldPos.isVector3 ? worldPos : new THREE.Vector3(worldPos[0], worldPos[1], worldPos[2]);
    const norm = normal.isVector3 ? normal : new THREE.Vector3(normal[0], normal[1], normal[2]);
    const b = new Building(type, pos, norm, this.scene, this.planet, yaw);
    this.buildings.push(b);
    return b;
  }

  removeBuilding(building) {
    const idx = this.buildings.indexOf(building);
    if (idx === -1) return;
    // Remove connected belts
    for (let i = this.belts.length - 1; i >= 0; i--) {
      if (this.belts[i].from === building || this.belts[i].to === building) {
        this.belts[i].dispose();
        this.belts.splice(i, 1);
      }
    }
    building.dispose();
    this.buildings.splice(idx, 1);
  }

  connectBelts(fromBuilding, toBuilding, forcedTier = null) {
    if (fromBuilding === toBuilding) return null;
    // Find best belt tier
    let tier = forcedTier;
    if (!tier) {
      tier = 'belt_basic';
      if (this.economy.isUnlocked('belt_ultra')) tier = 'belt_ultra';
      else if (this.economy.isUnlocked('belt_fast')) tier = 'belt_fast';
    }
    const belt = new Belt(fromBuilding, toBuilding, this.scene, tier);
    this.belts.push(belt);
    return belt;
  }

  startBeltFrom(building) {
    this._pendingBeltFrom = building;
  }

  finishBeltTo(building) {
    if (!this._pendingBeltFrom || this._pendingBeltFrom === building) {
      this._pendingBeltFrom = null;
      return null;
    }
    const belt = this.connectBelts(this._pendingBeltFrom, building);
    this._pendingBeltFrom = null;
    return belt;
  }

  // Push items from the player's inventory directly into a building's input
  // buffer (manual feeding, e.g. for a Smelter that needs Coal + Chunks).
  // Returns the list of item names that were transferred.
  feedFromInventory(building, inventory) {
    const fed = [];
    for (const entry of inventory.sortedEntries()) {
      let count = inventory.count(entry.name);
      let moved = 0;
      while (count > 0 && building.receiveItem(entry.name, 1)) {
        count--;
        moved++;
      }
      if (moved > 0) {
        inventory.remove(entry.name, moved);
        fed.push(`${entry.name}×${moved}`);
      }
    }
    return fed;
  }

  getBuildingAt(raycaster) {
    const meshes = this.buildings.map(b => b.mesh);
    const hits = raycaster.intersectObjects(meshes);
    if (hits.length === 0) return null;
    const hitMesh = hits[0].object;
    return this.buildings.find(b => b.mesh === hitMesh) || null;
  }

  getTotalThroughput() {
    return this.buildings.reduce((s, b) => s + b.throughput, 0);
  }

  getStatusSummary() {
    const counts = { running: 0, starved: 0, blocked: 0, unpowered: 0, idle: 0 };
    for (const b of this.buildings) counts[b.status] = (counts[b.status] || 0) + 1;
    return counts;
  }
}
