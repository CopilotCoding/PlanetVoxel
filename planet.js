import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';
import { PLANET_RADIUS, CHUNK_SIZE, ISO_LEVEL } from './constants.js';
import { createNoiseSet, density as densityField, getMaterial as materialField, getBiome as biomeField } from './terrain/density.js';
import { marchChunk, buildGeometry } from './terrain/mesher.js';
import { mine, mineFast, raise, lower, flatten } from './terrain/editor.js';
import { ChunkWorkerPool } from './terrain/workerPool.js';

// Marching cubes lookup tables are loaded globally as edgeTable / triTable
// via the CDN fetch in main.js before this module runs.

function chunkKey(cx, cy, cz) { return `${cx},${cy},${cz}`; }

export class Planet {
  constructor(scene, seed) {
    this.scene = scene;
    this.seed = seed;
    this.noiseSet = createNoiseSet(seed);
    this.chunks = new Map();
    this.meshes = new Map();
    this.dirtyChunks = new Set();
    // Sparse map of mined voxel overrides: "x,y,z" -> delta subtracted
    this._mineOverrides = new Map();
    // Sparse map of voxels whose override represents a constant-radius shell
    // (set by raise/lower/flatten): "x,y,z" -> targetR. Lets density() return
    // a smooth sphere-shell function of the *continuous* query radius for
    // these voxels, instead of a flat per-voxel delta — see density().
    this._shellTargetR = new Map();
    // Worker pool for off-main-thread chunk generation/meshing — used for
    // the initial planet build and for remeshing chunks after edits, so
    // neither the loading screen nor gameplay ever blocks on this work.
    this.workerPool = new ChunkWorkerPool(seed);
    // Chunks currently in-flight to a worker, so they aren't requested twice.
    this._meshingInFlight = new Set();
    this.material = new THREE.ShaderMaterial({
      side: THREE.FrontSide,
      uniforms: {
        sunPosition:     { value: new THREE.Vector3() },
        sunIntensity:    { value: 1.2 },
        lanternPosition: { value: new THREE.Vector3() },
        lanternIntensity:{ value: 0.0 },
        lanternRange:    { value: 1.0 },
        ambientIntensity:{ value: 0.03 },
      },
      vertexShader: `
        attribute float skyAccess;
        attribute vec3 color;
        varying vec3 vColor;
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        varying float vSkyAccess;
        void main() {
          vColor = color;
          vSkyAccess = skyAccess;
          // World-space normal — the planet mesh has an identity model matrix,
          // so object-space normals already ARE world-space. Using normalMatrix
          // (view-space) here made terrain lighting rotate with the camera.
          vNormal = normalize(normal);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3  sunPosition;
        uniform float sunIntensity;
        uniform vec3  lanternPosition;
        uniform float lanternIntensity;
        uniform float lanternRange;
        uniform float ambientIntensity;
        varying vec3  vColor;
        varying vec3  vNormal;
        varying vec3  vWorldPos;
        varying float vSkyAccess;
        void main() {
          vec3 n = normalize(vNormal);
          // Sun — only reaches surfaces with sky access
          vec3  sunDir  = normalize(sunPosition - vWorldPos);
          float sunDot  = max(0.0, dot(n, sunDir));
          // Also gate by whether this surface point faces the sun from planet center
          // Flatten the falloff so the whole day hemisphere is well-lit, not
          // just the area right under the sun — boundary stays at the same
          // place (0 at terminator, 1 at sub-solar point), just less steep.
          float hemisphereDot = pow(max(0.0, dot(normalize(vWorldPos), sunDir)), 0.35); // >0 = day side
          float sunContrib_intensity = sunDot * hemisphereDot * sunIntensity * vSkyAccess;
          vec3  sunContrib = sunContrib_intensity * vec3(1.0, 0.97, 0.88);
          // Lantern — tight quadratic falloff, fills all angles so no dark patches
          vec3  lDir    = lanternPosition - vWorldPos;
          float lDist   = length(lDir);
          float lDot    = max(0.0, dot(n, normalize(lDir)));
          float lScaled = lDist / lanternRange;
          float lAtten  = lanternIntensity / (1.0 + lScaled * lScaled * 0.18);
          float lFill   = lAtten * 0.45; // angle-independent fill so front walls stay lit
          vec3  lanternContrib = (lDot * lAtten + lFill) * vec3(1.0, 0.80, 0.47);
          vec3  light = vec3(ambientIntensity) + sunContrib + lanternContrib;
          gl_FragColor = vec4(vColor * light, 1.0);
        }
      `,
    });
    this._buildInitialChunks();
  }

  // Bundles the override maps into the shape terrain/density.js and
  // terrain/editor.js expect.
  get _overrides() {
    return { mineOverrides: this._mineOverrides, shellTargetR: this._shellTargetR };
  }

  // Plain-object snapshot of the override maps for postMessage to workers
  // (Maps clone fine via structured clone, but plain objects are smaller
  // and avoid relying on that across older browser versions).
  //
  // If cx/cy/cz are given, only entries whose voxel falls within that
  // chunk's density grid (+1 voxel margin, since marchChunk samples a
  // (CHUNK_SIZE+1)^3 grid and edits can spill into a neighbouring chunk's
  // grid at shared boundary voxels) are included. Sending the FULL global
  // override maps on every remesh request was the bottleneck: with many
  // extractors continuously mining, these maps grow to cover the whole
  // planet, and postMessage has to structured-clone that entire blob for
  // every dirty chunk — that's the multi-second visual remesh lag (the
  // collider updates instantly because mineFast patches this.chunks
  // in-place on the main thread, no postMessage involved).
  _overridesPlain(cx = null, cy = null, cz = null) {
    if (cx === null) {
      return {
        mineOverrides: Object.fromEntries(this._mineOverrides),
        shellTargetR: Object.fromEntries(this._shellTargetR),
      };
    }
    const lo0 = -1;
    const hi = CHUNK_SIZE + 1;
    const minX = cx * CHUNK_SIZE + lo0, maxX = cx * CHUNK_SIZE + hi;
    const minY = cy * CHUNK_SIZE + lo0, maxY = cy * CHUNK_SIZE + hi;
    const minZ = cz * CHUNK_SIZE + lo0, maxZ = cz * CHUNK_SIZE + hi;
    const inRange = (key) => {
      const [vx, vy, vz] = key.split(',').map(Number);
      return vx >= minX && vx <= maxX && vy >= minY && vy <= maxY && vz >= minZ && vz <= maxZ;
    };
    const mineOverrides = {};
    for (const [key, val] of this._mineOverrides) if (inRange(key)) mineOverrides[key] = val;
    const shellTargetR = {};
    for (const [key, val] of this._shellTargetR) if (inRange(key)) shellTargetR[key] = val;
    return { mineOverrides, shellTargetR };
  }

  // Scalar field: positive inside planet, negative outside
  density(x, y, z) {
    return densityField(this.noiseSet, this._overrides, x, y, z);
  }

  // Material at a given world position
  getMaterial(x, y, z) {
    return materialField(this.noiseSet, x, y, z);
  }

  getBiome(nx, ny, nz) {
    return biomeField(this.noiseSet, nx, ny, nz);
  }

  worldToChunk(x, y, z) {
    return [Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)];
  }

  getChunkData(cx, cy, cz) {
    const key = chunkKey(cx, cy, cz);
    if (this.chunks.has(key)) return this.chunks.get(key);
    const data = this._generateChunk(cx, cy, cz);
    this.chunks.set(key, data);
    return data;
  }

  _generateChunk(cx, cy, cz) {
    const n = CHUNK_SIZE + 1;
    const densities = new Float32Array(n * n * n);
    const materials = new Uint8Array(n * n * n);
    for (let lz = 0; lz < n; lz++) {
      for (let ly = 0; ly < n; ly++) {
        for (let lx = 0; lx < n; lx++) {
          const wx = cx * CHUNK_SIZE + lx;
          const wy = cy * CHUNK_SIZE + ly;
          const wz = cz * CHUNK_SIZE + lz;
          const idx = lz * n * n + ly * n + lx;
          densities[idx] = this.density(wx, wy, wz);
          materials[idx] = this.getMaterial(wx, wy, wz).id;
        }
      }
    }
    return { densities, materials, cx, cy, cz };
  }

  _buildInitialChunks() {
    const r = Math.ceil(PLANET_RADIUS / CHUNK_SIZE) + 1;
    const build = [];
    for (let cx = -r; cx <= r; cx++)
    for (let cy = -r; cy <= r; cy++)
    for (let cz = -r; cz <= r; cz++) {
      const wx = cx * CHUNK_SIZE + CHUNK_SIZE/2;
      const wy = cy * CHUNK_SIZE + CHUNK_SIZE/2;
      const wz = cz * CHUNK_SIZE + CHUNK_SIZE/2;
      const dist = Math.sqrt(wx*wx + wy*wy + wz*wz);
      if (dist < PLANET_RADIUS + CHUNK_SIZE * 2) build.push([cx, cy, cz]);
    }
    this._chunksToGenerate = build;
    this._genIndex = 0;
  }

  // Generates and meshes every initial chunk via the worker pool, applying
  // results to the scene as they arrive. Calls onProgress(fraction) as
  // chunks complete. Resolves once all initial chunks are in the scene.
  // Runs entirely off the main thread aside from applying finished meshes,
  // so the loading screen stays responsive throughout.
  async buildInitialChunksAsync(onProgress) {
    const list = this._chunksToGenerate;
    if (!list) { onProgress(1); return; }
    const total = list.length;
    let done = 0;
    const overridesObj = this._overridesPlain();

    await Promise.all(list.map(async ([cx, cy, cz]) => {
      const key = chunkKey(cx, cy, cz);
      const result = await this.workerPool.meshChunk(cx, cy, cz, overridesObj);
      this.chunks.set(key, { densities: result.densities, materials: result.materials, cx, cy, cz });
      this._applyMeshResult(key, result.meshData);
      done++;
      onProgress(done / total);
    }));

    this._chunksToGenerate = null;
  }

  // timeLimitMs: stop meshing after this many ms (prevents frame spikes during play).
  // Dispatches dirty chunks to the worker pool (capped to avoid flooding the
  // queue) and applies finished meshes to the scene as they resolve —
  // remeshing after edits never blocks the main thread.
  meshChunksDirty(timeLimitMs = 6) {
    if (this.dirtyChunks.size === 0) return;
    const t0 = performance.now();
    const maxInFlight = this.workerPool.size * 2;
    for (const key of this.dirtyChunks) {
      if (performance.now() - t0 > timeLimitMs) break;
      if (this._meshingInFlight.has(key)) continue;
      if (this._meshingInFlight.size >= maxInFlight) break;
      const [cx, cy, cz] = key.split(',').map(Number);
      this.dirtyChunks.delete(key);
      this._meshingInFlight.add(key);
      // Per-chunk filtered overrides — see _overridesPlain() comment. Sending
      // only the edits relevant to this chunk (instead of every edit on the
      // whole planet) is what fixes the visual remesh lag with many
      // extractors continuously mining.
      const overridesObj = this._overridesPlain(cx, cy, cz);
      this.workerPool.meshChunk(cx, cy, cz, overridesObj).then(result => {
        this._meshingInFlight.delete(key);
        // Keep the cached density/material arrays in sync so collision
        // queries and future edits see the same data the mesh was built
        // from (the chunk may have been edited again before this resolved —
        // applyVoxelOverride already patches individual voxels in-place, so
        // only refresh if we don't already have a (possibly newer) entry).
        if (!this.chunks.has(key)) {
          this.chunks.set(key, { densities: result.densities, materials: result.materials, cx, cy, cz });
        }
        this._applyMeshResult(key, result.meshData);
      });
    }
  }

  // Wraps a worker's meshData into a BufferGeometry and swaps it into the scene.
  _applyMeshResult(key, meshData) {
    const geo = buildGeometry(meshData);
    if (!geo) {
      const old = this.meshes.get(key);
      if (old) { this.scene.remove(old); old.geometry.dispose(); this.meshes.delete(key); }
      return;
    }
    const old = this.meshes.get(key);
    if (old) { this.scene.remove(old); old.geometry.dispose(); }
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.scene.add(mesh);
    this.meshes.set(key, mesh);
  }

  // Synchronous main-thread remesh — used as a fallback (e.g. dispose/edge
  // cases) where waiting on a worker round-trip isn't appropriate.
  _remeshChunkSync(cx, cy, cz) {
    const key = chunkKey(cx, cy, cz);
    const chunk = this.getChunkData(cx, cy, cz);
    const meshData = marchChunk(this.noiseSet, this._overrides, chunk);
    this._applyMeshResult(key, meshData);
  }

  // ---- Terrain editing tools ----

  get _editCtx() {
    return {
      noiseSet: this.noiseSet,
      overrides: this._overrides,
      chunks: this.chunks,
      dirtyChunks: this.dirtyChunks,
    };
  }

  // Deform terrain — mine a sphere at world position
  mine(wx, wy, wz, radius, onCollect) {
    return mine(this._editCtx, wx, wy, wz, radius, onCollect);
  }

  // Optimized mine variant used only by automated Extractor buildings —
  // see terrain/editor.js mineFast() for details.
  mineFast(wx, wy, wz, radius, onCollect) {
    return mineFast(this._editCtx, wx, wy, wz, radius, onCollect);
  }

  // Raise terrain toward a constant-radius shell — see terrain/editor.js
  raise(wx, wy, wz, radius, onConsume, planeR = null) {
    return raise(this._editCtx, wx, wy, wz, radius, onConsume, planeR);
  }

  // Lower terrain toward a constant-radius shell — see terrain/editor.js
  lower(wx, wy, wz, radius, onCollect, planeR = null) {
    return lower(this._editCtx, wx, wy, wz, radius, onCollect, planeR);
  }

  // Level terrain toward a constant-radius shell — see terrain/editor.js
  flatten(wx, wy, wz, radius, onCollect, planeR = null) {
    return flatten(this._editCtx, wx, wy, wz, radius, onCollect, planeR);
  }

  // ---- Raycasting / queries ----

  // Raycast against planet surface — returns { point, normal, distance } or null
  raycast(origin, direction, maxDist = 200) {
    const step = 0.4;
    let prevD = this.density(origin.x, origin.y, origin.z) - ISO_LEVEL;
    for (let t = step; t < maxDist; t += step) {
      const px = origin.x + direction.x * t;
      const py = origin.y + direction.y * t;
      const pz = origin.z + direction.z * t;
      const d = this.density(px, py, pz) - ISO_LEVEL;
      if (prevD > 0 && d <= 0 || prevD <= 0 && d > 0) {
        // Binary search refinement
        let lo = t - step, hi = t;
        for (let i = 0; i < 8; i++) {
          const mid = (lo + hi) * 0.5;
          const mx = origin.x + direction.x * mid;
          const my = origin.y + direction.y * mid;
          const mz = origin.z + direction.z * mid;
          if (this.density(mx, my, mz) > ISO_LEVEL) lo = mid; else hi = mid;
        }
        const ft = (lo + hi) * 0.5;
        const point = new THREE.Vector3(
          origin.x + direction.x * ft,
          origin.y + direction.y * ft,
          origin.z + direction.z * ft
        );
        const eps = 0.1;
        const normal = new THREE.Vector3(
          this.density(point.x + eps, point.y, point.z) - this.density(point.x - eps, point.y, point.z),
          this.density(point.x, point.y + eps, point.z) - this.density(point.x, point.y - eps, point.z),
          this.density(point.x, point.y, point.z + eps) - this.density(point.x, point.y, point.z - eps)
        ).normalize();
        return { point, normal, distance: ft };
      }
      prevD = d;
    }
    return null;
  }

  surfaceNormal(pos) {
    const eps = 0.5;
    const n = new THREE.Vector3(
      this.density(pos.x+eps, pos.y, pos.z) - this.density(pos.x-eps, pos.y, pos.z),
      this.density(pos.x, pos.y+eps, pos.z) - this.density(pos.x, pos.y-eps, pos.z),
      this.density(pos.x, pos.y, pos.z+eps) - this.density(pos.x, pos.y, pos.z-eps)
    );
    if (n.lengthSq() < 0.0001) return pos.clone().normalize();
    return n.normalize();
  }

  // Find surface point above a world position (binary search along radius direction)
  findSurface(pos, searchUp = 10, searchDown = 30) {
    const dir = pos.clone().normalize();
    const r = pos.length();
    // Search outward from deep to surface
    let lo = r - searchDown, hi = r + searchUp;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) * 0.5;
      const p = dir.clone().multiplyScalar(mid);
      if (this.density(p.x, p.y, p.z) > ISO_LEVEL) lo = mid; else hi = mid;
    }
    return dir.clone().multiplyScalar((lo + hi) * 0.5);
  }

  isInsidePlanet(pos) {
    return this.density(pos.x, pos.y, pos.z) > 0;
  }

  getMaterialAt(x, y, z) {
    return this.getMaterial(x, y, z);
  }

  // Get chunk-aligned voxel density for building placement check
  isSolidNear(pos, radius = 1.5) {
    for (let dx = -radius; dx <= radius; dx += radius)
    for (let dy = -radius; dy <= radius; dy += radius)
    for (let dz = -radius; dz <= radius; dz += radius) {
      if (this.density(pos.x+dx, pos.y+dy, pos.z+dz) > ISO_LEVEL) return true;
    }
    return false;
  }

  dispose() {
    for (const [, mesh] of this.meshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.meshes.clear();
    this.workerPool.dispose();
  }
}
