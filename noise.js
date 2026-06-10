// Seeded PRNG and noise — all functions accept a seed so worlds are reproducible

function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function buildPermTable(rng) {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  return perm;
}

function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(a, b, t) { return a + t * (b - a); }

function grad3(hash, x, y, z) {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
}

export class SeededNoise {
  constructor(seed) {
    this.seed = seed;
    const rng = mulberry32(seed);
    this.perm = buildPermTable(rng);
  }

  perlin3(x, y, z) {
    const perm = this.perm;
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = fade(x), v = fade(y), w = fade(z);
    const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
    const B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
    return lerp(
      lerp(
        lerp(grad3(perm[AA], x, y, z),     grad3(perm[BA], x-1, y, z),   u),
        lerp(grad3(perm[AB], x, y-1, z),   grad3(perm[BB], x-1, y-1, z), u), v),
      lerp(
        lerp(grad3(perm[AA+1], x, y, z-1), grad3(perm[BA+1], x-1, y, z-1),   u),
        lerp(grad3(perm[AB+1], x, y-1, z-1),grad3(perm[BB+1], x-1, y-1, z-1),u), v), w
    );
  }

  // Fractional Brownian Motion
  fbm(x, y, z, octaves = 5, lacunarity = 2.0, gain = 0.5) {
    let value = 0, amplitude = 0.5, frequency = 1.0, max = 0;
    for (let i = 0; i < octaves; i++) {
      value += this.perlin3(x * frequency, y * frequency, z * frequency) * amplitude;
      max += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return value / max;
  }

  // Returns value in [0,1]
  fbm01(x, y, z, octaves = 5) {
    return this.fbm(x, y, z, octaves) * 0.5 + 0.5;
  }
}
