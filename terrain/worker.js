// Chunk-generation worker. Runs entirely off the main thread so terrain
// generation/meshing never blocks the UI or loading screen.
//
// Classic (non-module) worker so `importScripts` can load marching-cubes.js,
// which defines `edgeTable`/`triTable` as plain `var`s (becomes globals on
// the worker scope, exactly like marchChunk() expects on the main thread).
// ES modules (density.js, mesher.js, constants.js) are loaded via dynamic
// import(), which classic workers support.
//
// Protocol (all messages are { type, ... }):
//   in  'init'  { seed }                          -> sets up noiseSet, no reply
//   in  'mesh'  { id, cx, cy, cz, mineOverrides, shellTargetR }
//                                                  -> generates + marches a chunk,
//                                                     replies 'meshResult'
//   out 'meshResult' { id, cx, cy, cz, densities, materials, meshData|null }
//        meshData (if non-null): { positions, colors, skyAccess } typed arrays

importScripts('../marching-cubes.js');

let noiseSet = null;
let CHUNK_SIZE, density, getMaterial, marchChunk, createNoiseSet;

const ready = (async () => {
  const constants = await import('../constants.js');
  const densityMod = await import('./density.js');
  const marchMod = await import('./march.js');
  CHUNK_SIZE = constants.CHUNK_SIZE;
  createNoiseSet = densityMod.createNoiseSet;
  density = densityMod.density;
  getMaterial = densityMod.getMaterial;
  marchChunk = marchMod.marchChunk;
})();

function toMap(obj) {
  return new Map(Object.entries(obj || {}));
}

self.onmessage = async (e) => {
  await ready;
  const msg = e.data;
  if (msg.type === 'init') {
    noiseSet = createNoiseSet(msg.seed);
    return;
  }
  if (msg.type === 'mesh') {
    const { id, cx, cy, cz } = msg;
    const overrides = {
      mineOverrides: toMap(msg.mineOverrides),
      shellTargetR: toMap(msg.shellTargetR),
    };

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
          densities[idx] = density(noiseSet, overrides, wx, wy, wz);
          materials[idx] = getMaterial(noiseSet, wx, wy, wz).id;
        }
      }
    }

    const chunk = { densities, materials, cx, cy, cz };
    const meshData = marchChunk(noiseSet, overrides, chunk);

    const transfer = [densities.buffer, materials.buffer];
    if (meshData) {
      transfer.push(meshData.positions.buffer, meshData.colors.buffer, meshData.skyAccess.buffer);
    }

    self.postMessage({ type: 'meshResult', id, cx, cy, cz, densities, materials, meshData }, transfer);
  }
};
