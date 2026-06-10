import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';

export { marchChunk } from './march.js';

// Wraps marchChunk()'s typed arrays into a THREE.BufferGeometry. Main-thread
// only — Web Workers use marchChunk() directly from march.js and send the
// raw typed arrays back for the main thread to wrap.
export function buildGeometry(meshData) {
  if (!meshData) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position',  new THREE.BufferAttribute(meshData.positions, 3));
  geo.setAttribute('color',     new THREE.BufferAttribute(meshData.colors, 3));
  geo.setAttribute('skyAccess', new THREE.BufferAttribute(meshData.skyAccess, 1));
  geo.computeVertexNormals();
  return geo;
}
