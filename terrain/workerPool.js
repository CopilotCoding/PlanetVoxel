// Pool of classic Web Workers (terrain/worker.js) that generate + mesh
// chunks off the main thread. Initial planet build and edit-triggered
// remeshes are dispatched here so the loading screen stays responsive and
// gameplay never stalls on a meshing spike.
//
// Each worker is independent and stateless aside from its noiseSet (set via
// 'init'); any worker can mesh any chunk, so requests are simply round-robin
// dispatched and queued if all workers are busy.
export class ChunkWorkerPool {
  constructor(seed, size = null) {
    const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
    // Leave a couple of cores free for the render/main thread and browser —
    // diminishing returns beyond ~12 workers for chunk meshing anyway.
    this.size = size || Math.max(2, Math.min(cores - 2, 12));
    this.workers = [];
    this.queue = [];
    this.nextId = 1;
    this.pending = new Map(); // id -> { resolve, reject }
    this.busy = new Array(this.size).fill(false);

    for (let i = 0; i < this.size; i++) {
      const worker = new Worker(new URL('./worker.js', import.meta.url));
      worker.postMessage({ type: 'init', seed });
      worker.onmessage = (e) => this._onMessage(i, e);
      worker.onerror = (e) => {
        console.error('Chunk worker error:', e.message, e);
      };
      this.workers.push(worker);
    }
  }

  _onMessage(workerIndex, e) {
    const msg = e.data;
    if (msg.type === 'meshResult') {
      const entry = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      this.busy[workerIndex] = false;
      if (entry) entry.resolve(msg);
      this._pump(workerIndex);
    }
  }

  _pump(workerIndex) {
    if (this.busy[workerIndex]) return;
    const job = this.queue.shift();
    if (!job) return;
    this.busy[workerIndex] = true;
    this.workers[workerIndex].postMessage(job.payload);
  }

  _findFreeWorker() {
    for (let i = 0; i < this.size; i++) if (!this.busy[i]) return i;
    return -1;
  }

  // Requests generation+meshing of chunk (cx,cy,cz). `overridesObj` is
  // { mineOverrides, shellTargetR } as plain objects (from Object.fromEntries
  // of the planet's override Maps). Returns a promise resolving to
  // { cx, cy, cz, densities, materials, meshData|null }.
  meshChunk(cx, cy, cz, overridesObj) {
    const id = this.nextId++;
    const payload = {
      type: 'mesh', id, cx, cy, cz,
      mineOverrides: overridesObj.mineOverrides,
      shellTargetR: overridesObj.shellTargetR,
    };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const free = this._findFreeWorker();
      if (free >= 0) {
        this.busy[free] = true;
        this.workers[free].postMessage(payload);
      } else {
        this.queue.push({ payload });
      }
    });
  }

  dispose() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.pending.clear();
    this.queue = [];
  }
}
