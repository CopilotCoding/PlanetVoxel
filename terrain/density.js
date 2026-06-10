import { PLANET_RADIUS, ISO_LEVEL, MATERIAL_LIST, BIOME_COLORS } from '../constants.js';
import { SeededNoise } from '../noise.js';

// Pure terrain scalar-field generation: density(), getMaterial(), getBiome().
// Depends only on a seed and noise generators — no THREE, no chunk/mesh
// state — so it can run unmodified on the main thread or inside a Web Worker.

export function createNoiseSet(seed) {
  return {
    noise:  new SeededNoise(seed),
    noise2: new SeededNoise(seed ^ 0xDEADBEEF),
    noise3: new SeededNoise(seed ^ 0xCAFEBABE),
  };
}

// Scalar field: positive inside planet, negative outside.
// `overrides`: { mineOverrides: Map("x,y,z"->delta), shellTargetR: Map("x,y,z"->targetR) }
export function density(noiseSet, overrides, x, y, z) {
  const { noise, noise2, noise3 } = noiseSet;
  const ix = Math.round(x), iy = Math.round(y), iz = Math.round(z);
  const r = Math.sqrt(x*x + y*y + z*z);

  // Voxels touched by raise/lower/flatten store the constant-radius shell
  // they were leveled to. The mesh only ever samples integer (ix,iy,iz)
  // points, where the override-based formula below is exact — but the
  // player's collision probes query *continuous* (x,y,z) positions. At
  // those points the raw terrain noise (which varies by up to ±28 over a
  // single voxel) would otherwise leak back in, since the override is a
  // flat per-voxel delta subtracted from a continuously-varying base field.
  // That created huge per-cell density swings the player's collider could
  // catch on, producing large hops while walking on tool-flattened ground.
  // Returning a pure function of the continuous radius here instead makes
  // the shell perfectly smooth between voxel centers, matching the flat
  // mesh exactly.
  const shellKey = `${ix},${iy},${iz}`;
  const targetR = overrides.shellTargetR.get(shellKey);
  if (targetR !== undefined) return ISO_LEVEL + (targetR - r);

  const nx = x / PLANET_RADIUS, ny = y / PLANET_RADIUS, nz = z / PLANET_RADIUS;

  // Base sphere
  let d = PLANET_RADIUS - r;

  // Large-scale terrain deformation
  const terrain = noise.fbm(nx * 2.1, ny * 2.1, nz * 2.1, 4) * 28;
  d += terrain;

  // Cave tunnels — a connected network of constant-radius tubes running
  // from near the planet core out to surface mouths.
  //
  // Two independent 3D noise fields (noise2, noise3) each define a smooth
  // scalar field over space. The ZERO-SET of a single 3D scalar field is a
  // 2D surface; the INTERSECTION of two such zero-sets is generically a 1D
  // CURVE — exactly a tunnel centerline. tunnelDist below (the Euclidean
  // distance in "field-value space" from (fieldA,fieldB) to the origin) is
  // 0 exactly on that curve and grows smoothly away from it in every
  // direction, giving a round tube of constant radius along its whole
  // length — no tapering, no spatial hashing/grids (which caused
  // discontinuous density jumps at cell boundaries previously).
  //
  // Where two DIFFERENT pairs of fields' curves pass near each other, both
  // tubes carve the same region — this is what makes nearby tunnels link up
  // into a connected network. Sampling the fields at moderate frequency
  // relative to the planet means curves are dense enough to frequently pass
  // near one another and connect, while still leaving plenty of solid rock
  // between separate strands.
  //
  // No radius gating (e.g. r > some threshold) — the curves run through the
  // whole volume including r≈0 (core) and r≈PLANET_RADIUS (surface), so
  // tunnels reach very deep AND naturally poke through the surface as mouths
  // wherever a curve happens to cross the surface shell.
  {
    const TUNNEL_FREQ = 1.6;
    const tx = nx * TUNNEL_FREQ, ty = ny * TUNNEL_FREQ, tz = nz * TUNNEL_FREQ;

    // A single curve network — the intersection of the zero-sets of two
    // independent noise fields forms a 1D curve through space (a tunnel
    // centerline). Where strands of this curve pass near each other,
    // they naturally link up into a connected network without needing a
    // second independent field pair (which doubled the total carved volume
    // and produced far more tunnels than intended).
    const fA1 = noise2.fbm(tx, ty, tz, 3);
    const fA2 = noise3.fbm(tx + 31.7, ty - 19.3, tz + 7.1, 3);
    const tunnelDist = Math.sqrt(fA1 * fA1 + fA2 * fA2);

    // Hard cliff, not a smooth falloff: any point inside the tunnel radius
    // is pushed to a large fixed negative density, full stop. A smooth
    // falloff can leave a point only PARTIALLY carved — pulled down but not
    // past ISO_LEVEL — which meshes as a thin, normal-looking solid crust
    // hiding a fully-carved (and thus open/air) point right next to it. The
    // hard cliff means every point along a tunnel's cross-section is
    // uniformly deep air, so the tube always punches cleanly through the
    // surface into open space with no hidden half-carved slivers.
    const TUNNEL_RADIUS = 0.05;
    if (tunnelDist < TUNNEL_RADIUS && d > ISO_LEVEL - 200) {
      d = ISO_LEVEL - 200;
    }
  }

  // Apply mining overrides (sparse)
  const key = `${ix},${iy},${iz}`;
  const ov = overrides.mineOverrides.get(key);
  if (ov !== undefined) d -= ov;

  return d;
}

// Material at a given world position
export function getMaterial(noiseSet, x, y, z) {
  const { noise2, noise3 } = noiseSet;
  const r = Math.sqrt(x*x + y*y + z*z);
  const depth = Math.max(0, Math.min(1, (PLANET_RADIUS - r) / PLANET_RADIUS));
  const nx = x / PLANET_RADIUS, ny = y / PLANET_RADIUS, nz = z / PLANET_RADIUS;

  // Vein noise
  const vein1 = noise2.fbm01(nx * 12, ny * 12, nz * 12, 3);
  const vein2 = noise3.fbm01(nx * 9 + 7, ny * 9 + 7, nz * 9 + 7, 3);

  // Very deep veins
  if (depth > 0.78 && vein1 > 0.72) return MATERIAL_LIST[8]; // Xenonite
  if (depth > 0.68 && vein2 > 0.70) return MATERIAL_LIST[7]; // Gem

  // Deep
  if (depth > 0.43 && vein1 > 0.60) return MATERIAL_LIST[6]; // Quartz
  if (depth > 0.38 && vein2 > 0.62) return MATERIAL_LIST[5]; // Titanium

  // Mid
  if (depth > 0.13 && vein1 > 0.58) return MATERIAL_LIST[4]; // Coal
  if (depth > 0.13 && vein2 > 0.60) return MATERIAL_LIST[3]; // Copper
  if (depth > 0.09 && vein1 > 0.55) return MATERIAL_LIST[2]; // Iron

  // Surface
  if (depth > 0.05) return MATERIAL_LIST[1]; // Rock
  return MATERIAL_LIST[0]; // Regolith
}

export function getBiome(noiseSet, nx, ny, nz) {
  const b = noiseSet.noise.fbm01(nx * 1.5, ny * 1.5, nz * 1.5, 3);
  return BIOME_COLORS[Math.floor(b * BIOME_COLORS.length) % BIOME_COLORS.length];
}
