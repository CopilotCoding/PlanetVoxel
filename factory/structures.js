import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';
import { BUILDING_DEFS, PLANET_RADIUS, MINE_RADIUS, ISO_LEVEL } from '../constants.js';
import { findRecipe, getRecipesFor } from './recipes.js';

const POWER_RANGE = 40;
let _idCounter = 0;

export class Building {
  constructor(type, position, normal, scene, planet, yaw = 0) {
    this.id = ++_idCounter;
    this.type = type;
    this.def = BUILDING_DEFS[type];
    this.position = position.clone();
    this.normal = normal.clone();
    this.scene = scene;
    this.planet = planet;
    this.inputBuffer = {};
    this.outputBuffer = {};
    this.status = 'idle';
    this.processTimer = 0;
    this.currentRecipe = null;
    this.powered = type !== 'smelter' && type !== 'assembler';
    this.powerConsumed = 0;
    this.throughput = 0;
    this._throughputTimer = 0;
    this._throughputCount = 0;
    this.yaw = yaw;
    this._drillFrontier = 0; // current shaft depth the extractor's laser has bored to
    this._laserMesh = null;
    this._laserLen = 0;       // current animated beam length
    this._laserTargetLen = 0; // target length (0 when idle, drill depth when firing)
    this._buildMesh();
  }

  _buildMesh() {
    const color = this.def.color;
    let geo;
    switch (this.type) {
      case 'extractor':  geo = new THREE.CylinderGeometry(0.6, 0.9, 1.8, 6); break;
      case 'crusher':    geo = new THREE.BoxGeometry(1.4, 1.4, 1.4); break;
      case 'smelter':    geo = new THREE.CylinderGeometry(0.5, 0.8, 2.2, 8); break;
      case 'fabricator': geo = new THREE.OctahedronGeometry(1.0); break;
      case 'assembler':  geo = new THREE.DodecahedronGeometry(1.1); break;
      case 'storage':    geo = new THREE.BoxGeometry(1.6, 1.0, 1.6); break;
      case 'terminal':   geo = new THREE.BoxGeometry(1.0, 2.0, 0.3); break;
      case 'generator':  geo = new THREE.CylinderGeometry(0.7, 0.7, 1.6, 8); break;
      case 'pylon':      geo = new THREE.ConeGeometry(0.3, 3.0, 8); break;
      case 'sorter':     geo = new THREE.BoxGeometry(1.2, 0.6, 1.2); break;
      default:           geo = new THREE.BoxGeometry(1.2, 1.2, 1.2);
    }
    const mat = new THREE.MeshLambertMaterial({ color });
    this.mesh = new THREE.Mesh(geo, mat);

    // Emissive accent
    const accentGeo = new THREE.SphereGeometry(0.18, 6, 6);
    const accentMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.accentMesh = new THREE.Mesh(accentGeo, accentMat);
    this.accentMesh.position.set(0, 1.2, 0);

    this.group = new THREE.Group();
    this.group.add(this.mesh);
    this.group.add(this.accentMesh);

    // Orient to surface: local +Y = surface normal (outward), bottom faces terrain.
    // Extractor is flipped 180° so its TOP (drill end) faces the terrain.
    this._applyTransform();
    this.scene.add(this.group);

    // Status light colors
    this._statusColors = {
      running: 0x00ff44, starved: 0xffaa00, blocked: 0xff2222, unpowered: 0x444444, idle: 0x888888
    };

    // Extractor drill laser
    if (this.type === 'extractor') {
      const laserGeo = new THREE.BoxGeometry(0.06, 0.06, 1);
      const laserMat = new THREE.MeshBasicMaterial({
        color: 0xff2200,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      this._laserMesh = new THREE.Mesh(laserGeo, laserMat);
      this._laserMesh.visible = false;
      this.scene.add(this._laserMesh);
    }
  }

  update(dt, economy, inventory) {
    this._throughputTimer += dt;
    if (this._throughputTimer >= 10) {
      this.throughput = this._throughputCount / this._throughputTimer;
      this._throughputTimer = 0;
      this._throughputCount = 0;
    }

    switch (this.type) {
      case 'extractor':   this._updateExtractor(dt); break;
      case 'crusher':
      case 'smelter':
      case 'fabricator':
      case 'assembler':   this._updateProcessor(dt); break;
      case 'storage':     this._updateStorage(dt); break;
      case 'terminal':    this._updateTerminal(dt, economy, inventory); break;
      case 'generator':   this._updateGenerator(dt); break;
      case 'sorter':      this._updateSorter(dt); break;
    }

    // Update accent color
    const c = this._statusColors[this.status] || 0x888888;
    this.accentMesh.material.color.setHex(c);

    // Slowly rotate octahedron / dodecahedron
    if (this.type === 'fabricator' || this.type === 'assembler') {
      this.mesh.rotation.y += dt * 0.5;
    }

    // Animate extractor drill laser
    if (this._laserMesh) {
      const speed = 30;
      if (this._laserTargetLen > 0) {
        this._laserLen = Math.min(this._laserLen + speed * dt, this._laserTargetLen);
      } else {
        this._laserLen = Math.max(this._laserLen - speed * dt, 0);
      }
      if (this._laserLen > 0.05) {
        this._laserMesh.visible = true;
        const down = this.normal.clone().negate(); // normal is outward, laser fires inward
        // Start at the drill tip (top of extractor = closest to terrain)
        const start = this.position.clone().addScaledVector(this.normal, -0.9);
        this._laserMesh.position.copy(start).addScaledVector(down, this._laserLen * 0.5);
        this._laserMesh.scale.set(1, 1, this._laserLen);
        this._laserMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), down);
        // Pulse opacity
        this._laserMesh.material.opacity = 0.6 + 0.4 * Math.sin(Date.now() * 0.015);
      } else {
        this._laserMesh.visible = false;
      }
    }
  }

  _updateExtractor(dt) {
    if (!this.powered) { this.status = 'unpowered'; this._laserTargetLen = 0; return; }

    // Heat system: the laser runs continuously at full speed for RUN_TIME
    // seconds, then must cool for COOL_TIME seconds before firing again —
    // gives it a steady, fast drilling pace without running forever unchecked.
    const RUN_TIME = 20.0;
    const COOL_TIME = 6.0;
    if (this._drillCooldown === undefined) this._drillCooldown = 0;
    if (this._drillHeat === undefined) this._drillHeat = 0;

    if (this._drillCooldown > 0) {
      this._drillCooldown -= dt;
      this.status = 'unpowered'; // reuse "unpowered" red-ish state to show overheated/idle
      this._laserTargetLen = 0;
      return;
    }

    this.processTimer -= dt;
    if (this.processTimer > 0) { this.status = 'running'; return; }
    this.processTimer = 0.25; // fast, steady drilling tick

    const MAX_DRILL_DEPTH = 60;
    const DRILL_RADIUS = MINE_RADIUS * 1.2; // wide enough to actually clear a walkable shaft
    const drill = this.normal.clone().negate();
    // Bore through whatever is currently blocking the shaft — Regolith and
    // Rock included — so the laser physically tunnels deeper each cycle
    // instead of "seeing through" solid ground to a deposit it never carved
    // a path to. Scan from the current shaft floor (or the surface, the
    // first time) for the first still-solid voxel and chew through that.
    let mineX = null, mineY = null, mineZ = null, drillDepth = 0;
    const startD = Math.max(0.5, this._drillFrontier || 0.5);
    for (let d = startD; d <= MAX_DRILL_DEPTH; d += 0.5) {
      const px = this.position.x + drill.x * d;
      const py = this.position.y + drill.y * d;
      const pz = this.position.z + drill.z * d;
      if (this.planet.density(px, py, pz) > ISO_LEVEL) {
        mineX = px; mineY = py; mineZ = pz; drillDepth = d;
        break;
      }
    }
    if (mineX === null) {
      // Shaft already bored to max depth and the floor is clear — nothing
      // left to drill within range.
      this.status = 'starved';
      this._laserTargetLen = 0;
      return;
    }
    // Fire the beam several times this tick — a sustained laser, not a single
    // weak pulse — so even dense deep rock gets carved through at a steady pace.
    for (let i = 0; i < 4; i++) {
      this.planet.mine(mineX, mineY, mineZ, DRILL_RADIUS, (collected) => {
        for (const [name, count] of Object.entries(collected)) {
          if (name === 'Regolith' || name === 'Rock') continue;
          this.outputBuffer[name] = (this.outputBuffer[name] || 0) + count;
          this._throughputCount += count;
        }
      });
    }
    // Advance the drill frontier — keep boring at this depth until it's
    // fully cleared (density check next cycle), then push deeper.
    this._drillFrontier = drillDepth;
    this.status = 'running';
    this._laserTargetLen = drillDepth;

    // Track how long the laser has been continuously firing; once it hits
    // RUN_TIME, force a cooldown period.
    this._drillHeat += dt + 0.25;
    if (this._drillHeat >= RUN_TIME) {
      this._drillHeat = 0;
      this._drillCooldown = COOL_TIME;
    }
  }

  _updateProcessor(dt) {
    if (!this.powered) { this.status = 'unpowered'; return; }
    // Try to start a recipe
    if (!this.currentRecipe) {
      const recipe = findRecipe(this.type, this.inputBuffer);
      if (recipe) {
        for (const [item, count] of Object.entries(recipe.inputs)) {
          this.inputBuffer[item] = (this.inputBuffer[item] || 0) - count;
          if (this.inputBuffer[item] <= 0) delete this.inputBuffer[item];
        }
        this.currentRecipe = recipe;
        this.processTimer = recipe.time;
        this.status = 'running';
      } else {
        this.status = 'starved';
        return;
      }
    }
    this.processTimer -= dt;
    if (this.processTimer <= 0) {
      const recipe = this.currentRecipe;
      this.currentRecipe = null;
      for (const [item, count] of Object.entries(recipe.outputs)) {
        this.outputBuffer[item] = (this.outputBuffer[item] || 0) + count;
        this._throughputCount += count;
      }
      this.status = 'running';
    }
  }

  _updateStorage(dt) {
    const total = Object.values(this.inputBuffer).reduce((a,b)=>a+b, 0);
    if (total >= 500) { this.status = 'blocked'; return; }
    this.status = total > 0 ? 'running' : 'idle';
    // Pass everything through to output
    for (const [item, count] of Object.entries(this.inputBuffer)) {
      this.outputBuffer[item] = (this.outputBuffer[item] || 0) + count;
    }
    this.inputBuffer = {};
  }

  _updateTerminal(dt, economy, inventory) {
    // Auto-sell everything in input buffer
    for (const [item, count] of Object.entries(this.inputBuffer)) {
      if (count > 0) {
        economy.sell(item, count);
        this._throughputCount += count;
      }
    }
    this.inputBuffer = {};
    // Also sell from player inventory if market_plus is unlocked
    if (economy.isUnlocked('market_plus')) {
      for (const entry of inventory.sortedEntries()) {
        const sold = economy.sell(entry.name, entry.count);
        inventory.remove(entry.name, entry.count);
      }
    }
    this.status = 'running';
  }

  _updateGenerator(dt) {
    if ((this.inputBuffer['Coal'] || 0) > 0) {
      this.processTimer -= dt;
      if (this.processTimer <= 0) {
        this.inputBuffer['Coal']--;
        if (this.inputBuffer['Coal'] <= 0) delete this.inputBuffer['Coal'];
        this.processTimer = 8.0;
        this._throughputCount++;
      }
      this.status = 'running';
      this.powerConsumed = 0;
    } else {
      this.status = 'starved';
    }
  }

  _updateSorter(dt) {
    this.status = Object.keys(this.inputBuffer).length > 0 ? 'running' : 'idle';
    // Pass to output without modification (routing is handled by belt system)
    for (const [item, count] of Object.entries(this.inputBuffer)) {
      this.outputBuffer[item] = (this.outputBuffer[item] || 0) + count;
    }
    this.inputBuffer = {};
  }

  receiveItem(itemName, count = 1) {
    // Storage and terminal accept anything
    if (this.type === 'storage' || this.type === 'terminal') {
      const MAX = this.type === 'storage' ? 500 : 20;
      const total = Object.values(this.inputBuffer).reduce((a,b)=>a+b,0);
      if (total >= MAX) return false;
      this.inputBuffer[itemName] = (this.inputBuffer[itemName] || 0) + count;
      return true;
    }
    // Generator only accepts coal
    if (this.type === 'generator') {
      if (itemName !== 'Coal') return false;
      const total = Object.values(this.inputBuffer).reduce((a,b)=>a+b,0);
      if (total >= 20) return false;
      this.inputBuffer[itemName] = (this.inputBuffer[itemName] || 0) + count;
      return true;
    }
    // Processors only accept items that appear in at least one of their recipes
    const recipes = getRecipesFor(this.type);
    const accepted = new Set(recipes.flatMap(r => Object.keys(r.inputs)));
    if (!accepted.has(itemName)) return false;
    const total = Object.values(this.inputBuffer).reduce((a,b)=>a+b,0);
    if (total >= 20) return false;
    this.inputBuffer[itemName] = (this.inputBuffer[itemName] || 0) + count;
    return true;
  }

  takeOutput(itemName) {
    if (!this.outputBuffer[itemName] || this.outputBuffer[itemName] <= 0) return false;
    this.outputBuffer[itemName]--;
    if (this.outputBuffer[itemName] <= 0) delete this.outputBuffer[itemName];
    return true;
  }

  getFirstOutput() {
    const keys = Object.keys(this.outputBuffer);
    for (const k of keys) {
      if (this.outputBuffer[k] > 0) return k;
    }
    return null;
  }

  _applyTransform() {
    this.group.position.copy(this.position);
    const up = this.normal;
    const worldUp = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(worldUp, up);
    const qYaw = new THREE.Quaternion().setFromAxisAngle(up, this.yaw);
    let orient = qYaw.multiply(q);
    if (this.type === 'extractor') {
      const flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
      orient = orient.multiply(flip);
    }
    this.group.setRotationFromQuaternion(orient);
  }

  // Relocate an already-placed building to a new surface position/orientation
  // (used by the "move building" tool — no cost, the building just gets picked up
  // and dropped elsewhere).
  reposition(position, normal, yaw) {
    this.position.copy(position);
    this.normal.copy(normal);
    this.yaw = yaw;
    this._applyTransform();
  }

  setPowered(val) {
    this.powered = val;
  }

  dispose() {
    this.scene.remove(this.group);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    if (this._laserMesh) {
      this.scene.remove(this._laserMesh);
      this._laserMesh.geometry.dispose();
      this._laserMesh.material.dispose();
    }
  }
}
