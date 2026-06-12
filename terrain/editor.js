import { CHUNK_SIZE, ISO_LEVEL } from '../constants.js';
import { density, getMaterial } from './density.js';

// Terrain-editing tools: mine/raise/lower/flatten. Each takes the planet's
// noiseSet, override maps, chunk cache and dirty-set so it can update the
// cached density values in-place and mark affected chunks for remeshing.
// `chunkKey` is passed in to avoid a circular import with planet.js.

function chunkKeyOf(cx, cy, cz) { return `${cx},${cy},${cz}`; }

// Re-applies a per-voxel override delta and refreshes the cached density
// in every chunk that voxel touches (shared by raise/flatten).
function applyVoxelOverride(ctx, vx, vy, vz, newOverride, affectedChunks) {
  const { noiseSet, overrides, chunks } = ctx;
  const key = `${vx},${vy},${vz}`;
  if (newOverride === 0) overrides.mineOverrides.delete(key);
  else overrides.mineOverrides.set(key, newOverride);

  const newDensity = density(noiseSet, overrides, vx, vy, vz);
  const cx = Math.floor(vx / CHUNK_SIZE);
  const cy = Math.floor(vy / CHUNK_SIZE);
  const cz = Math.floor(vz / CHUNK_SIZE);
  const N = CHUNK_SIZE + 1;
  for (let ocx = cx-1; ocx <= cx; ocx++)
  for (let ocy = cy-1; ocy <= cy; ocy++)
  for (let ocz = cz-1; ocz <= cz; ocz++) {
    const ck = chunkKeyOf(ocx, ocy, ocz);
    const cdata = chunks.get(ck);
    if (cdata) {
      const lx = vx - ocx * CHUNK_SIZE;
      const ly = vy - ocy * CHUNK_SIZE;
      const lz = vz - ocz * CHUNK_SIZE;
      if (lx >= 0 && lx < N && ly >= 0 && ly < N && lz >= 0 && lz < N) {
        cdata.densities[lz * N * N + ly * N + lx] = newDensity;
      }
    }
    affectedChunks.add(ck);
  }
}

// Deform terrain — mine a sphere at world position
export function mine(ctx, wx, wy, wz, radius, onCollect) {
  const { noiseSet, overrides, chunks } = ctx;
  const collected = {};
  const ir = Math.ceil(radius);
  const affectedChunks = new Set();

  for (let dx = -ir; dx <= ir; dx++)
  for (let dy = -ir; dy <= ir; dy++)
  for (let dz = -ir; dz <= ir; dz++) {
    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
    if (dist > radius) continue;
    const vx = Math.round(wx) + dx;
    const vy = Math.round(wy) + dy;
    const vz = Math.round(wz) + dz;
    const key = `${vx},${vy},${vz}`;
    const t = 1 - dist / radius;
    const delta = t * t * 6.0;
    const before = density(noiseSet, overrides, vx, vy, vz);
    if (before > -30) {
      if (before >= ISO_LEVEL - 0.5 && before - delta < ISO_LEVEL) {
        const mat = getMaterial(noiseSet, vx, vy, vz);
        collected[mat.name] = (collected[mat.name] || 0) + 1;
      }
      const existing = overrides.mineOverrides.get(key) || 0;
      overrides.mineOverrides.set(key, existing + delta);
      // Mining this voxel further invalidates any "flat shell" marker from
      // a previous raise/lower/flatten — the voxel is no longer a pure
      // function of its radius, so fall back to the normal override path.
      overrides.shellTargetR.delete(key);
      // Update only the changed voxel in each chunk's density cache.
      // This avoids wiping and regenerating the entire 17³ cache per chunk.
      const newDensity = density(noiseSet, overrides, vx, vy, vz); // already has override applied
      const cx = Math.floor(vx / CHUNK_SIZE);
      const cy = Math.floor(vy / CHUNK_SIZE);
      const cz = Math.floor(vz / CHUNK_SIZE);
      const N = CHUNK_SIZE + 1;
      for (let ocx = cx-1; ocx <= cx; ocx++)
      for (let ocy = cy-1; ocy <= cy; ocy++)
      for (let ocz = cz-1; ocz <= cz; ocz++) {
        const ck = chunkKeyOf(ocx, ocy, ocz);
        const cdata = chunks.get(ck);
        if (cdata) {
          const lx = vx - ocx * CHUNK_SIZE;
          const ly = vy - ocy * CHUNK_SIZE;
          const lz = vz - ocz * CHUNK_SIZE;
          if (lx >= 0 && lx < N && ly >= 0 && ly < N && lz >= 0 && lz < N) {
            cdata.densities[lz * N * N + ly * N + lx] = newDensity;
          }
        }
        affectedChunks.add(ck);
      }
    }
  }

  for (const k of affectedChunks) ctx.dirtyChunks.add(k);
  if (onCollect) onCollect(collected);
}

// Faster variant of mine(), used only by automated Extractor buildings (NOT
// player mining — that stays on the original mine() above, untouched). Same
// sphere-carve/collection behavior, but cuts the per-voxel cost roughly in
// half by avoiding redundant work — extractors call this every ~0.6s,
// continuously, for every extractor placed, so this steady-state cost adds
// up fast with several extractors running at once.
export function mineFast(ctx, wx, wy, wz, radius, onCollect) {
  const { noiseSet, overrides, chunks } = ctx;
  const collected = {};
  const ir = Math.ceil(radius);
  const affectedChunks = new Set();

  for (let dx = -ir; dx <= ir; dx++)
  for (let dy = -ir; dy <= ir; dy++)
  for (let dz = -ir; dz <= ir; dz++) {
    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
    if (dist > radius) continue;
    const vx = Math.round(wx) + dx;
    const vy = Math.round(wy) + dy;
    const vz = Math.round(wz) + dz;
    const key = `${vx},${vy},${vz}`;
    const t = 1 - dist / radius;
    const delta = t * t * 6.0;
    const before = density(noiseSet, overrides, vx, vy, vz);
    if (before > -30) {
      if (before >= ISO_LEVEL - 0.5 && before - delta < ISO_LEVEL) {
        const mat = getMaterial(noiseSet, vx, vy, vz);
        collected[mat.name] = (collected[mat.name] || 0) + 1;
      }
      // If this voxel had a "flat shell" marker, `before` was computed via
      // the shell formula (independent of mineOverrides) — the algebraic
      // shortcut below doesn't apply for those, so fall back to a real
      // density() recompute in that (rare) case only.
      const hadShell = overrides.shellTargetR.has(key);
      overrides.shellTargetR.delete(key);
      const existing = overrides.mineOverrides.get(key) || 0;
      overrides.mineOverrides.set(key, existing + delta);
      // density() = baseNoiseDensity(...) - mineOverride, and `delta` is
      // exactly what was just added to mineOverrides, so newDensity =
      // before - delta without re-running the expensive multi-octave noise
      // a second time.
      const newDensity = hadShell ? density(noiseSet, overrides, vx, vy, vz) : before - delta;
      const cx = Math.floor(vx / CHUNK_SIZE);
      const cy = Math.floor(vy / CHUNK_SIZE);
      const cz = Math.floor(vz / CHUNK_SIZE);
      const N = CHUNK_SIZE + 1;
      const lx0 = vx - cx * CHUNK_SIZE;
      const ly0 = vy - cy * CHUNK_SIZE;
      const lz0 = vz - cz * CHUNK_SIZE;
      // Voxels strictly inside one chunk's cached grid only need that one
      // chunk updated — only boundary voxels (local coord 0 or CHUNK_SIZE)
      // also fall within a neighboring chunk's grid.
      if (lx0 > 0 && lx0 < CHUNK_SIZE && ly0 > 0 && ly0 < CHUNK_SIZE && lz0 > 0 && lz0 < CHUNK_SIZE) {
        const ck = chunkKeyOf(cx, cy, cz);
        const cdata = chunks.get(ck);
        if (cdata) cdata.densities[lz0 * N * N + ly0 * N + lx0] = newDensity;
        affectedChunks.add(ck);
      } else {
        for (let ocx = cx-1; ocx <= cx; ocx++)
        for (let ocy = cy-1; ocy <= cy; ocy++)
        for (let ocz = cz-1; ocz <= cz; ocz++) {
          const ck = chunkKeyOf(ocx, ocy, ocz);
          const cdata = chunks.get(ck);
          if (cdata) {
            const lx = vx - ocx * CHUNK_SIZE;
            const ly = vy - ocy * CHUNK_SIZE;
            const lz = vz - ocz * CHUNK_SIZE;
            if (lx >= 0 && lx < N && ly >= 0 && ly < N && lz >= 0 && lz < N) {
              cdata.densities[lz * N * N + ly * N + lx] = newDensity;
            }
          }
          affectedChunks.add(ck);
        }
      }
    }
  }

  for (const k of affectedChunks) ctx.dirtyChunks.add(k);
  if (onCollect) onCollect(collected);
}

// Raise terrain — within `radius` (horizontal/disc distance from the hit
// point, measured along the local tangent plane), fills every voxel whose
// radial distance from the planet center is below `planeR` up toward
// ISO_LEVEL at that radius. `planeR` defaults to a small step above the
// current surface height at (wx,wy,wz), so each tick raises the ground a
// little further — repeated ticks build a perfectly radial column from the
// planet center up to the target height.
// onConsume(needed) is called once with the total voxel count this would
// add; the caller should return how many the player can afford (e.g. based
// on Regolith in inventory) — only that many voxels (closest to the surface
// first) are actually raised.
export function raise(ctx, wx, wy, wz, radius, onConsume, planeR = null) {
  const { overrides, noiseSet } = ctx;
  const ir = Math.ceil(radius);
  const affectedChunks = new Set();
  const candidates = [];

  const hitR = Math.sqrt(wx*wx + wy*wy + wz*wz);
  const RAISE_STEP = 0.5;
  const targetR = planeR !== null ? planeR : hitR + RAISE_STEP;

  for (let dx = -ir; dx <= ir; dx++)
  for (let dy = -ir; dy <= ir; dy++)
  for (let dz = -ir; dz <= ir; dz++) {
    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
    if (dist > radius) continue;
    const vx = Math.round(wx) + dx;
    const vy = Math.round(wy) + dy;
    const vz = Math.round(wz) + dz;

    const r = Math.sqrt(vx*vx + vy*vy + vz*vz);
    if (r > targetR) continue; // above the target radial height — leave alone

    const before = density(noiseSet, overrides, vx, vy, vz);
    const targetDensity = ISO_LEVEL + (targetR - r);
    // Inner region snaps fully to the target each tick — produces a flat-
    // topped column (every voxel reaches the same target radius together,
    // not a dome/cone where the center races ahead of the edges). Only the
    // outer rim (t < EDGE_FRAC) blends partially, tapering smoothly into
    // the surrounding untouched terrain.
    const t = 1 - dist / radius;
    const EDGE_FRAC = 0.25;
    const strength = t >= EDGE_FRAC ? 1.0 : (t / EDGE_FRAC) * (t / EDGE_FRAC);
    const diff = (targetDensity - before) * strength;
    if (diff <= 0.01) continue; // already solid enough

    candidates.push({ vx, vy, vz, dist, diff, strength });
  }

  if (candidates.length === 0) return 0;
  candidates.sort((a, b) => a.dist - b.dist);

  const allowed = onConsume ? onConsume(candidates.length) : candidates.length;
  const count = Math.max(0, Math.min(allowed, candidates.length));

  for (let i = 0; i < count; i++) {
    const { vx, vy, vz, diff, strength } = candidates[i];
    const key = `${vx},${vy},${vz}`;
    const existing = overrides.mineOverrides.get(key) || 0;
    // override is subtracted from density, so to ADD `diff` to density we subtract `diff` from override
    applyVoxelOverride(ctx, vx, vy, vz, existing - diff, affectedChunks);
    // Fully-snapped (inner-region) voxels sit exactly on the targetR shell —
    // mark them so density() returns a smooth shell function for continuous
    // (collision) queries. Partial-strength edge voxels are a blend with
    // natural terrain, not a pure shell, so leave/clear their entry.
    if (strength >= 1.0) overrides.shellTargetR.set(key, targetR);
    else overrides.shellTargetR.delete(key);
  }

  for (const k of affectedChunks) ctx.dirtyChunks.add(k);
  return count;
}

// Lower terrain — within `radius` (disc distance from the hit point along
// the local tangent plane), carves every voxel whose radial distance from
// the planet center is above `planeR` down toward ISO_LEVEL at that radius.
// `planeR` defaults to a small step below the current surface height at
// (wx,wy,wz), so repeated ticks dig a perfectly radial column straight down
// toward the planet center.
export function lower(ctx, wx, wy, wz, radius, onCollect, planeR = null) {
  const { overrides, noiseSet } = ctx;
  const collected = {};
  const ir = Math.ceil(radius);
  const affectedChunks = new Set();

  const hitR = Math.sqrt(wx*wx + wy*wy + wz*wz);
  const LOWER_STEP = 0.5;
  const targetR = planeR !== null ? planeR : hitR - LOWER_STEP;

  for (let dx = -ir; dx <= ir; dx++)
  for (let dy = -ir; dy <= ir; dy++)
  for (let dz = -ir; dz <= ir; dz++) {
    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
    if (dist > radius) continue;
    const vx = Math.round(wx) + dx;
    const vy = Math.round(wy) + dy;
    const vz = Math.round(wz) + dz;

    const r = Math.sqrt(vx*vx + vy*vy + vz*vz);
    if (r < targetR) continue; // below the target radial height — leave alone

    const before = density(noiseSet, overrides, vx, vy, vz);
    const targetDensity = ISO_LEVEL + (targetR - r);
    // Inner region snaps fully to the target each tick — produces a flat-
    // bottomed column (every voxel reaches the same target radius
    // together, not a dome/cone where the center races ahead of the
    // edges). Only the outer rim (t < EDGE_FRAC) blends partially,
    // tapering smoothly into the surrounding untouched terrain.
    const t = 1 - dist / radius;
    const EDGE_FRAC = 0.25;
    const strength = t >= EDGE_FRAC ? 1.0 : (t / EDGE_FRAC) * (t / EDGE_FRAC);
    const diff = (before - targetDensity) * strength;
    if (diff <= 0.01) continue; // already empty enough

    if (before >= ISO_LEVEL - 0.5 && before - diff < ISO_LEVEL) {
      const mat = getMaterial(noiseSet, vx, vy, vz);
      collected[mat.name] = (collected[mat.name] || 0) + 1;
    }

    const key = `${vx},${vy},${vz}`;
    const existing = overrides.mineOverrides.get(key) || 0;
    applyVoxelOverride(ctx, vx, vy, vz, existing + diff, affectedChunks);
    if (strength >= 1.0) overrides.shellTargetR.set(key, targetR);
    else overrides.shellTargetR.delete(key);
  }

  for (const k of affectedChunks) ctx.dirtyChunks.add(k);
  if (onCollect) onCollect(collected);
  return collected;
}

// Level terrain — levels voxels within radius toward the constant-radius
// shell at radial distance `planeR` from the planet center (i.e. "level"
// relative to gravity, curving with the planet). Voxels above the shell
// are carved down, voxels below are filled up, both toward ISO_LEVEL at
// that radius. If `planeR` is omitted, defaults to the current radial
// distance of (wx,wy,wz) (i.e. levels to the height under the cursor on
// the first tick).
export function flatten(ctx, wx, wy, wz, radius, onCollect, planeR = null) {
  const { overrides, noiseSet } = ctx;
  const collected = {};
  const ir = Math.ceil(radius);
  const affectedChunks = new Set();

  const targetR = planeR !== null ? planeR : Math.sqrt(wx*wx + wy*wy + wz*wz);

  for (let dx = -ir; dx <= ir; dx++)
  for (let dy = -ir; dy <= ir; dy++)
  for (let dz = -ir; dz <= ir; dz++) {
    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
    if (dist > radius) continue;
    const vx = Math.round(wx) + dx;
    const vy = Math.round(wy) + dy;
    const vz = Math.round(wz) + dz;

    const before = density(noiseSet, overrides, vx, vy, vz);
    // Target density at this voxel if the surface sat exactly on the
    // constant-radius shell: density ~= PLANET_RADIUS - r, so for the
    // leveling shell it's targetR-relative.
    const r = Math.sqrt(vx*vx + vy*vy + vz*vz);
    const targetDensity = ISO_LEVEL + (targetR - r);

    const diff = targetDensity - before;
    if (Math.abs(diff) < 0.01) continue;

    const t = 1 - dist / radius;
    // Inner region snaps fully to the target plane each tick (so the
    // flattened area converges to an exactly planar density field — no
    // residual ripples for the player to bob over). Only the outer rim
    // (where t < EDGE_FRAC) blends partially, tapering smoothly into the
    // surrounding untouched terrain.
    const EDGE_FRAC = 0.25;
    const strength = t >= EDGE_FRAC ? 1.0 : (t / EDGE_FRAC) * (t / EDGE_FRAC);
    const step = diff * strength;

    if (before >= ISO_LEVEL - 0.5 && before + step < ISO_LEVEL && step < 0) {
      const mat = getMaterial(noiseSet, vx, vy, vz);
      collected[mat.name] = (collected[mat.name] || 0) + 1;
    }

    const key = `${vx},${vy},${vz}`;
    const existing = overrides.mineOverrides.get(key) || 0;
    // override is subtracted from density, so to ADD `step` to density we subtract `step` from override
    applyVoxelOverride(ctx, vx, vy, vz, existing - step, affectedChunks);
    if (strength >= 1.0) overrides.shellTargetR.set(key, targetR);
    else overrides.shellTargetR.delete(key);
  }

  for (const k of affectedChunks) ctx.dirtyChunks.add(k);
  if (onCollect) onCollect(collected);
}
