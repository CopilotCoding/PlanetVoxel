import { PLANET_RADIUS, CHUNK_SIZE, ISO_LEVEL, MATERIAL_LIST } from '../constants.js';
import { density, getBiome } from './density.js';

// Marching-cubes meshing for a single chunk's cached density/material arrays.
// Pure function of chunk data + noise/overrides (needed for the sky-access
// raycast, which samples density() at points outside this chunk) — no THREE
// dependency, so it can run on the main thread or inside a Web Worker without
// pulling in the renderer.
//
// Returns { positions, colors, skyAccess } typed arrays, or null if the chunk
// contains no surface (caller wraps these into a BufferGeometry).
export function marchChunk(noiseSet, overrides, chunk) {
  if (typeof edgeTable === 'undefined' || typeof triTable === 'undefined') return null;

  const { cx, cy, cz } = chunk;
  const N = CHUNK_SIZE + 1;
  const dens = chunk.densities;
  const mats = chunk.materials;

  // Precompute per-material RGB from the color integer — no THREE.Color in hot loop
  const matRGB = MATERIAL_LIST.map(m => [
    ((m.color >> 16) & 0xff) / 255,
    ((m.color >> 8)  & 0xff) / 255,
    ( m.color        & 0xff) / 255,
  ]);
  // Precompute biome surface RGB for this chunk (one sample at chunk center)
  const bcx = cx * CHUNK_SIZE + CHUNK_SIZE / 2;
  const bcy = cy * CHUNK_SIZE + CHUNK_SIZE / 2;
  const bcz = cz * CHUNK_SIZE + CHUNK_SIZE / 2;
  const biome = getBiome(noiseSet, bcx / PLANET_RADIUS, bcy / PLANET_RADIUS, bcz / PLANET_RADIUS);
  const bR = ((biome.surface >> 16) & 0xff) / 255;
  const bG = ((biome.surface >> 8)  & 0xff) / 255;
  const bB = ( biome.surface        & 0xff) / 255;

  // Pre-size output arrays for speed
  const posArr = [];
  const colArr = [];
  const skyArr = [];

  // Reusable edge vertex storage: [x, y, z, r, g, b, skyAccess] per edge
  const ev = new Float32Array(12 * 7);

  for (let lz = 0; lz < CHUNK_SIZE; lz++)
  for (let ly = 0; ly < CHUNK_SIZE; ly++)
  for (let lx = 0; lx < CHUNK_SIZE; lx++) {
    const i000 = lz*N*N + ly*N + lx;
    const d0 = dens[i000];
    const d1 = dens[i000 + 1];
    const d2 = dens[i000 + N + 1];
    const d3 = dens[i000 + N];
    const d4 = dens[i000 + N*N];
    const d5 = dens[i000 + N*N + 1];
    const d6 = dens[i000 + N*N + N + 1];
    const d7 = dens[i000 + N*N + N];

    let ci = 0;
    if (d0 < ISO_LEVEL) ci |= 1;
    if (d1 < ISO_LEVEL) ci |= 2;
    if (d2 < ISO_LEVEL) ci |= 4;
    if (d3 < ISO_LEVEL) ci |= 8;
    if (d4 < ISO_LEVEL) ci |= 16;
    if (d5 < ISO_LEVEL) ci |= 32;
    if (d6 < ISO_LEVEL) ci |= 64;
    if (d7 < ISO_LEVEL) ci |= 128;

    const E = edgeTable[ci];
    if (E === 0) continue;

    const wx0 = cx * CHUNK_SIZE + lx;
    const wy0 = cy * CHUNK_SIZE + ly;
    const wz0 = cz * CHUNK_SIZE + lz;

    // Inline interpolation — writes directly into ev[]
    const interp = (slot, ax, ay, az, bx, by, bz, va, vb, matA, matB) => {
      const t = (ISO_LEVEL - va) / (vb - va + 0.0001);
      const px = ax + t * (bx - ax);
      const py = ay + t * (by - ay);
      const pz = az + t * (bz - az);
      const matId = t < 0.5 ? matA : matB;
      const rgb = matRGB[matId] || matRGB[0];
      const r = Math.sqrt(px*px + py*py + pz*pz);
      const df = Math.max(0, 1 - (PLANET_RADIUS - r) / 10) * 0.55;
      // Sky access: shoot ray outward from vertex — solid above = underground
      const ir = r > 0.001 ? 1/r : 1;
      const ux = px*ir, uy = py*ir, uz = pz*ir;
      let sky = 1.0;
      for (let d = 2; d <= 28; d += 3) {
        if (density(noiseSet, overrides, px + ux*d, py + uy*d, pz + uz*d) > ISO_LEVEL) { sky = 0.0; break; }
      }
      const s = slot * 7;
      ev[s]   = px; ev[s+1] = py; ev[s+2] = pz;
      ev[s+3] = rgb[0] * (1-df) + bR * df;
      ev[s+4] = rgb[1] * (1-df) + bG * df;
      ev[s+5] = rgb[2] * (1-df) + bB * df;
      ev[s+6] = sky;
    };

    const m = (lx2, ly2, lz2) => mats[(lz+lz2)*N*N + (ly+ly2)*N + (lx+lx2)];

    if (E & 1)    interp(0,  wx0,wy0,wz0,       wx0+1,wy0,wz0,   d0,d1, m(0,0,0),m(1,0,0));
    if (E & 2)    interp(1,  wx0+1,wy0,wz0,     wx0+1,wy0+1,wz0, d1,d2, m(1,0,0),m(1,1,0));
    if (E & 4)    interp(2,  wx0+1,wy0+1,wz0,   wx0,wy0+1,wz0,   d2,d3, m(1,1,0),m(0,1,0));
    if (E & 8)    interp(3,  wx0,wy0+1,wz0,     wx0,wy0,wz0,     d3,d0, m(0,1,0),m(0,0,0));
    if (E & 16)   interp(4,  wx0,wy0,wz0+1,     wx0+1,wy0,wz0+1, d4,d5, m(0,0,1),m(1,0,1));
    if (E & 32)   interp(5,  wx0+1,wy0,wz0+1,   wx0+1,wy0+1,wz0+1,d5,d6,m(1,0,1),m(1,1,1));
    if (E & 64)   interp(6,  wx0+1,wy0+1,wz0+1, wx0,wy0+1,wz0+1, d6,d7, m(1,1,1),m(0,1,1));
    if (E & 128)  interp(7,  wx0,wy0+1,wz0+1,   wx0,wy0,wz0+1,   d7,d4, m(0,1,1),m(0,0,1));
    if (E & 256)  interp(8,  wx0,wy0,wz0,       wx0,wy0,wz0+1,   d0,d4, m(0,0,0),m(0,0,1));
    if (E & 512)  interp(9,  wx0+1,wy0,wz0,     wx0+1,wy0,wz0+1, d1,d5, m(1,0,0),m(1,0,1));
    if (E & 1024) interp(10, wx0+1,wy0+1,wz0,   wx0+1,wy0+1,wz0+1,d2,d6,m(1,1,0),m(1,1,1));
    if (E & 2048) interp(11, wx0,wy0+1,wz0,     wx0,wy0+1,wz0+1, d3,d7, m(0,1,0),m(0,1,1));

    const tb = ci * 16;
    for (let t = 0; t < 16; t += 3) {
      const i0 = triTable[tb + t];
      if (i0 === -1) break;
      const i1 = triTable[tb + t + 1];
      const i2 = triTable[tb + t + 2];
      const s0=i0*7, s1=i1*7, s2=i2*7;
      posArr.push(ev[s0],ev[s0+1],ev[s0+2], ev[s1],ev[s1+1],ev[s1+2], ev[s2],ev[s2+1],ev[s2+2]);
      colArr.push(ev[s0+3],ev[s0+4],ev[s0+5], ev[s1+3],ev[s1+4],ev[s1+5], ev[s2+3],ev[s2+4],ev[s2+5]);
      skyArr.push(ev[s0+6], ev[s1+6], ev[s2+6]);
    }
  }

  if (posArr.length === 0) return null;
  return {
    positions: new Float32Array(posArr),
    colors: new Float32Array(colArr),
    skyAccess: new Float32Array(skyArr),
  };
}
