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
    this.hasOutgoingBelt = false;
    // Market Terminal only: if non-null, restricts which item names the
    // terminal will accept from belts/feeding — anything not in this set is
    // passed through instead of being auto-sold. null/empty means "accept
    // anything" (default, matches old behaviour).
    this.allowedItems = this.type === 'terminal' ? new Set() : null;
    this.status = 'idle';
    this.processTimer = 0;
    this.activeJobs = []; // processors: recipes currently being crafted in parallel
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
    // Drilling tick interval. mine() cost scales with radius^3 and each
    // voxel runs several noise-heavy density()/getMaterial() samples — at
    // 0.25s this made every placed extractor a major per-frame cost,
    // especially once an ore-widened carve fires. A slower, steady tick
    // keeps the same "always drilling" feel at a small fraction of the cost.
    this.processTimer = 0.6;

    // Xenonite/Gem only spawn at depth fraction >= 0.70-0.80, i.e. radius
    // <= ~36-54 from the planet center (depth = (PLANET_RADIUS - r) /
    // PLANET_RADIUS, PLANET_RADIUS = 180). The old 120 cap stopped at r=60 —
    // just short of the Gem layer and well short of Xenonite. Extend close to
    // the core (r~10) so every vein layer is reachable, leaving a small
    // margin so the shaft never tries to bore through r=0 itself.
    const MAX_DRILL_DEPTH = 170;
    const DRILL_RADIUS = MINE_RADIUS; // narrow beam through plain dirt/rock
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
    // Check the frontier voxel AND a small ring of points around it (offset
    // perpendicular to the drill axis) for ore — a vein is a noise blob that
    // can sit just off the drill's exact center line, so checking only the
    // single on-axis point often misses it entirely and the shaft drills
    // straight through/past a vein without ever widening.
    const arb = Math.abs(drill.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    const perpA = new THREE.Vector3().crossVectors(drill, arb).normalize();
    const perpB = new THREE.Vector3().crossVectors(drill, perpA).normalize();
    let isOre = false;
    const checkPoints = [[0, 0]];
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2;
      checkPoints.push([Math.cos(ang) * DRILL_RADIUS, Math.sin(ang) * DRILL_RADIUS]);
    }
    for (const [a, b] of checkPoints) {
      const cx = mineX + perpA.x*a + perpB.x*b;
      const cy = mineY + perpA.y*a + perpB.y*b;
      const cz = mineZ + perpA.z*a + perpB.z*b;
      const mat = this.planet.getMaterial(cx, cy, cz);
      if (mat.name !== 'Regolith' && mat.name !== 'Rock') { isOre = true; break; }
    }
    // Widen the carve so the vein at this depth gets cleared out before the
    // shaft resumes narrow drilling through surrounding dirt/rock. Kept
    // modest — a large radius here iterates a huge number of voxels every
    // tick (cost scales with radius^3) and was the main source of lag with
    // multiple extractors running.
    const radius = isOre ? DRILL_RADIUS * 1.6 : DRILL_RADIUS;

    // Single carve per tick — firing this multiple times per tick multiplied
    // the (radius^3) voxel cost for little gain, and was the dominant cost
    // with several extractors active at once.
    // Collect everything the drill chews through, including Regolith/Rock —
    // they're worth ~0 each individually but give the extractor a steady
    // baseline trickle of sellable volume even between ore veins, instead of
    // discarding the bulk of every tick's carve.
    this.planet.mineFast(mineX, mineY, mineZ, radius, (collected) => {
      for (const [name, count] of Object.entries(collected)) {
        this.outputBuffer[name] = (this.outputBuffer[name] || 0) + count;
        this._throughputCount += count;
      }
    });
    // Decide whether to linger at this depth or advance the frontier.
    //
    // A single ~5.6-radius carve often doesn't fully clear a vein blob —
    // next tick's scan would then find the next solid voxel just past this
    // carve and move on, leaving the rest of the vein behind uncollected.
    // So: re-run the same ring ore-check AFTER the carve. If it still reads
    // as ore, DON'T advance _drillFrontier — keep it at this depth so next
    // tick re-scans from here, finds the (still partially solid) frontier
    // voxel again, and carves the same modest radius again. This repeats
    // until the ring-check comes back clean (pure Regolith/Rock or fully
    // carved/empty), at which point the shaft advances normally.
    //
    // Bound on "stuck forever": each carve permanently removes density
    // (delta = t*t*6.0 > 0 at the center, up to 6.0) from every voxel in
    // the ring-check footprint, so the ring voxels' density strictly
    // decreases each lingering tick. Eventually either the on-axis voxel
    // drops below ISO_LEVEL (mineX/Y/Z scan finds a new, deeper frontier
    // next tick) or the ring points fall fully outside the vein/below
    // ISO_LEVEL (ore check turns false). Either way this is a finite,
    // monotonically-progressing process — it cannot loop forever. As an
    // extra safety net, cap consecutive lingering ticks so a pathological
    // case (e.g. a vein wider than the ring radius) can't stall the shaft
    // indefinitely; after the cap, force the frontier forward.
    let stillOre = false;
    if (isOre) {
      for (const [a, b] of checkPoints) {
        const cx = mineX + perpA.x*a + perpB.x*b;
        const cy = mineY + perpA.y*a + perpB.y*b;
        const cz = mineZ + perpA.z*a + perpB.z*b;
        if (this.planet.density(cx, cy, cz) > ISO_LEVEL) {
          const mat = this.planet.getMaterial(cx, cy, cz);
          if (mat.name !== 'Regolith' && mat.name !== 'Rock') { stillOre = true; break; }
        }
      }
    }
    const MAX_LINGER_TICKS = 8;
    if (stillOre && (this._lingerTicks || 0) < MAX_LINGER_TICKS) {
      this._lingerTicks = (this._lingerTicks || 0) + 1;
      // Keep _drillFrontier as-is (don't advance) so next tick re-targets
      // this same vein depth.
    } else {
      this._lingerTicks = 0;
      // Advance the drill frontier — keep boring at this depth until it's
      // fully cleared (density check next cycle), then push deeper.
      this._drillFrontier = drillDepth;
    }
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

  // Crushers/smelters/etc. run every recipe their current input buffer can
  // support at once, each as its own independent timed job — e.g. a Crusher
  // with both Iron Ore and Copper Ore queued crushes both in parallel rather
  // than finishing Iron entirely before starting Copper. MAX_JOBS caps how
  // many recipes can be in flight simultaneously (purely so a building with
  // a huge backlog doesn't spawn an unbounded number of timers at once).
  _updateProcessor(dt) {
    if (!this.powered) { this.status = 'unpowered'; return; }
    if (!this.activeJobs) this.activeJobs = [];
    const MAX_JOBS = 4;

    // Start new jobs for any recipe whose inputs are currently available,
    // up to the concurrency cap. Consume inputs immediately on start so two
    // jobs can't both claim the same ingredient.
    while (this.activeJobs.length < MAX_JOBS) {
      const recipe = findRecipe(this.type, this.inputBuffer);
      if (!recipe) break;
      for (const [item, count] of Object.entries(recipe.inputs)) {
        this.inputBuffer[item] = (this.inputBuffer[item] || 0) - count;
        if (this.inputBuffer[item] <= 0) delete this.inputBuffer[item];
      }
      this.activeJobs.push({ recipe, timer: recipe.time });
    }

    if (this.activeJobs.length === 0) {
      this.status = 'starved';
      return;
    }

    // Advance all running jobs in parallel; finished ones deposit outputs.
    for (let i = this.activeJobs.length - 1; i >= 0; i--) {
      const job = this.activeJobs[i];
      job.timer -= dt;
      if (job.timer <= 0) {
        for (const [item, count] of Object.entries(job.recipe.outputs)) {
          this.outputBuffer[item] = (this.outputBuffer[item] || 0) + count;
          this._throughputCount += count;
        }
        this.activeJobs.splice(i, 1);
      }
    }
    this.status = 'running';
  }

  _updateStorage(dt) {
    // Always pass everything through to output, even when "full" — full just
    // means receiveItem() will stop accepting new input, not that the chest
    // stops draining what it's already holding onto outgoing belts. Returning
    // early here used to freeze the output buffer the moment input hit 500,
    // so a full chest looked permanently dead even while belts were actively
    // pulling items out of it.
    for (const [item, count] of Object.entries(this.inputBuffer)) {
      this.outputBuffer[item] = (this.outputBuffer[item] || 0) + count;
    }
    this.inputBuffer = {};
    const outTotal = Object.values(this.outputBuffer).reduce((a,b)=>a+b, 0);
    this.status = outTotal >= 500 ? 'blocked' : (outTotal > 0 ? 'running' : 'idle');
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
    // Terminal: if an allow-list is configured (non-empty), only accept item
    // types in it — anything else passes through down the belt line instead
    // of being auto-sold. Empty allow-list (default) means accept anything.
    if (this.type === 'terminal' && this.allowedItems && this.allowedItems.size > 0 && !this.allowedItems.has(itemName)) {
      return this._passThrough(itemName, count);
    }
    // Storage and terminal accept anything (subject to the allow-list check
    // above), capped on total items
    if (this.type === 'storage' || this.type === 'terminal') {
      const MAX = this.type === 'storage' ? 500 : 20;
      // Storage drains inputBuffer into outputBuffer every tick (see
      // _updateStorage), so inputBuffer alone is nearly always ~0 — the cap
      // has to be checked against both buffers combined, otherwise a "full"
      // chest (500 items sitting in outputBuffer waiting on a belt) would
      // keep accepting unlimited new input.
      const total = Object.values(this.inputBuffer).reduce((a,b)=>a+b,0)
                   + Object.values(this.outputBuffer).reduce((a,b)=>a+b,0);
      if (total >= MAX) return this._passThrough(itemName, count);
      this.inputBuffer[itemName] = (this.inputBuffer[itemName] || 0) + count;
      return true;
    }
    // Generator only accepts coal
    if (this.type === 'generator') {
      if (itemName !== 'Coal') return this._passThrough(itemName, count);
      if ((this.inputBuffer['Coal'] || 0) >= 20) return this._passThrough(itemName, count);
      this.inputBuffer[itemName] = (this.inputBuffer[itemName] || 0) + count;
      return true;
    }
    // Processors: each ingredient type used by any of this building's recipes
    // gets its own input slot (cap 20 each), so a backlog of one ingredient
    // never blocks a different ingredient from arriving on another belt.
    const recipes = getRecipesFor(this.type);
    const accepted = new Set(recipes.flatMap(r => Object.keys(r.inputs)));
    if (!accepted.has(itemName)) return this._passThrough(itemName, count);
    if ((this.inputBuffer[itemName] || 0) >= 20) return this._passThrough(itemName, count);
    this.inputBuffer[itemName] = (this.inputBuffer[itemName] || 0) + count;
    return true;
  }

  // Forward an item this building can't use (wrong type, or input buffer
  // full) straight to its own output buffer, so it continues down whatever
  // belt is connected from here — lets a single belt line run past multiple
  // machines, each pulling out only what it needs. Only possible if there's
  // somewhere for it to go; otherwise reject as before so it stays visibly
  // blocked on the belt instead of disappearing into a dead end.
  _passThrough(itemName, count) {
    if (!this.hasOutgoingBelt) return false;
    this.outputBuffer[itemName] = (this.outputBuffer[itemName] || 0) + count;
    return true;
  }

  takeOutput(itemName) {
    if (!this.outputBuffer[itemName] || this.outputBuffer[itemName] <= 0) return false;
    this.outputBuffer[itemName]--;
    if (this.outputBuffer[itemName] <= 0) delete this.outputBuffer[itemName];
    return true;
  }

  // Empty both buffers directly into the player's inventory — lets the
  // player manually drain a backed-up or misconfigured machine instead of
  // waiting for belts to slowly clear it. Returns the list of "Name×count"
  // strings transferred, for a UI confirmation message.
  emptyInto(inventory) {
    const moved = [];
    for (const buf of [this.inputBuffer, this.outputBuffer]) {
      for (const [item, count] of Object.entries(buf)) {
        if (count > 0) {
          inventory.add(item, count);
          moved.push(`${item}×${count}`);
        }
      }
    }
    this.inputBuffer = {};
    this.outputBuffer = {};
    this.activeJobs = [];
    return moved;
  }

  // If `destination` is given, only return an item type the destination
  // building can actually accept (wouldAccept) — sending something the
  // destination will reject means it either gets force-passed-through (if
  // the destination has its own outgoing belt) or gets stuck at the end of
  // THIS belt, blocking every other item type queued behind it. Better to
  // not pull anything this tick and let another belt (or a future tick, once
  // the destination frees up) move it instead. With no destination given
  // (legacy callers), fall back to the first available item.
  getFirstOutput(destination = null) {
    const keys = Object.keys(this.outputBuffer);
    if (!destination) {
      for (const k of keys) {
        if (this.outputBuffer[k] > 0) return k;
      }
      return null;
    }
    for (const k of keys) {
      if (this.outputBuffer[k] <= 0) continue;
      if (destination.wouldAccept(k)) return k;
    }
    return null;
  }

  // True if receiveItem(itemName) would be stored in this building's own
  // input buffer (not just passed through) — i.e. this building actually
  // wants/uses this item type.
  wouldAccept(itemName) {
    if (this.type === 'terminal' && this.allowedItems && this.allowedItems.size > 0 && !this.allowedItems.has(itemName)) {
      return false;
    }
    if (this.type === 'storage' || this.type === 'terminal') {
      const MAX = this.type === 'storage' ? 500 : 20;
      const total = Object.values(this.inputBuffer).reduce((a,b)=>a+b,0)
                   + Object.values(this.outputBuffer).reduce((a,b)=>a+b,0);
      return total < MAX;
    }
    if (this.type === 'generator') {
      return itemName === 'Coal' && (this.inputBuffer['Coal'] || 0) < 20;
    }
    const recipes = getRecipesFor(this.type);
    const accepted = new Set(recipes.flatMap(r => Object.keys(r.inputs)));
    return accepted.has(itemName) && (this.inputBuffer[itemName] || 0) < 20;
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
