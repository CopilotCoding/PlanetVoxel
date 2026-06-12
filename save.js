// IndexedDB-backed save system. Stores a list of worlds (metadata) plus a
// full save blob per world (player, inventory, economy, factory, planet
// terrain edits, sun/tool state).

const DB_NAME = 'planetvoxel';
const DB_VERSION = 1;
const WORLDS_STORE = 'worlds';
const SAVES_STORE = 'saves';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(WORLDS_STORE)) {
        db.createObjectStore(WORLDS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(SAVES_STORE)) {
        db.createObjectStore(SAVES_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, store, mode) {
  return db.transaction(store, mode).objectStore(store);
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class SaveManager {
  async init() {
    this.db = await openDB();
  }

  // Returns array of { id, name, seed, lastPlayed }, newest first
  async listWorlds() {
    const store = tx(this.db, WORLDS_STORE, 'readonly');
    const all = await reqToPromise(store.getAll());
    return all.sort((a, b) => b.lastPlayed - a.lastPlayed);
  }

  async createWorld(name, seed) {
    const id = `world_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const meta = { id, name, seed, lastPlayed: Date.now() };
    const store = tx(this.db, WORLDS_STORE, 'readwrite');
    await reqToPromise(store.put(meta));
    return meta;
  }

  async deleteWorld(id) {
    const worldsStore = tx(this.db, WORLDS_STORE, 'readwrite');
    await reqToPromise(worldsStore.delete(id));
    const savesStore = tx(this.db, SAVES_STORE, 'readwrite');
    await reqToPromise(savesStore.delete(id));
  }

  async touchWorld(id) {
    const store = tx(this.db, WORLDS_STORE, 'readwrite');
    const meta = await reqToPromise(store.get(id));
    if (meta) {
      meta.lastPlayed = Date.now();
      await reqToPromise(store.put(meta));
    }
  }

  async getSave(worldId) {
    const store = tx(this.db, SAVES_STORE, 'readonly');
    return reqToPromise(store.get(worldId));
  }

  async saveGame(worldId, data) {
    const store = tx(this.db, SAVES_STORE, 'readwrite');
    await reqToPromise(store.put({ id: worldId, ...data }));
    await this.touchWorld(worldId);
  }
}

// ---- Serialization helpers ----

export function serializeGame({ planet, player, inventory, economy, factory, sunAngle, toolIndex }) {
  return {
    sunAngle,
    toolIndex,
    planet: {
      mineOverrides: Array.from(planet._mineOverrides.entries()),
      shellTargetR: Array.from(planet._shellTargetR.entries()),
    },
    player: {
      position: player.position.toArray(),
      velH: [player._velH.x, player._velH.y, player._velH.z],
      velVert: player._velVert,
      fuel: player.fuel,
    },
    inventory: { items: { ...inventory.items } },
    economy: {
      money: economy.money,
      unlocked: Array.from(economy.unlocked),
      prices: { ...economy.prices },
      demandSpikes: { ...economy.demandSpikes },
      t: economy.t,
    },
    factory: {
      buildings: factory.buildings.map(b => ({
        id: b.id,
        type: b.type,
        position: b.position.toArray(),
        normal: b.normal.toArray(),
        yaw: b.yaw,
        inputBuffer: { ...b.inputBuffer },
        outputBuffer: { ...b.outputBuffer },
        allowedItems: b.allowedItems ? Array.from(b.allowedItems) : null,
      })),
      belts: factory.belts.map(belt => ({
        fromId: belt.from.id,
        toId: belt.to.id,
        tier: belt.tier,
      })),
    },
  };
}

// Applies a previously-serialized save onto a freshly constructed game.
// `factoryFromType` is a function (type, position, normal, yaw) => Building,
// used to reconstruct buildings via Factory's normal placement path (free,
// since cost was already paid in the original playthrough).
export function deserializeGame(save, { player, inventory, economy, factory, createBuilding, connectBelts }) {
  // Player
  if (save.player) {
    player.position.fromArray(save.player.position);
    if (save.player.velH) player._velH.set(save.player.velH[0], save.player.velH[1], save.player.velH[2]);
    if (save.player.velVert !== undefined) player._velVert = save.player.velVert;
    if (save.player.fuel !== undefined) player.fuel = save.player.fuel;
  }

  // Inventory
  if (save.inventory) inventory.items = { ...save.inventory.items };

  // Economy
  if (save.economy) {
    economy.money = save.economy.money;
    economy.unlocked = new Set(save.economy.unlocked);
    if (save.economy.prices) economy.prices = { ...save.economy.prices };
    if (save.economy.demandSpikes) economy.demandSpikes = { ...save.economy.demandSpikes };
    if (save.economy.t !== undefined) economy.t = save.economy.t;
  }

  // Factory — rebuild buildings (free placement, restoring buffers), then belts
  const idMap = new Map(); // saved id -> live Building instance
  if (save.factory && save.factory.buildings) {
    for (const b of save.factory.buildings) {
      const building = createBuilding(b.type, b.position, b.normal, b.yaw);
      if (!building) continue;
      building.inputBuffer = { ...b.inputBuffer };
      building.outputBuffer = { ...b.outputBuffer };
      if (building.allowedItems && b.allowedItems) building.allowedItems = new Set(b.allowedItems);
      idMap.set(b.id, building);
    }
  }
  if (save.factory && save.factory.belts) {
    for (const belt of save.factory.belts) {
      const from = idMap.get(belt.fromId);
      const to = idMap.get(belt.toId);
      if (from && to) connectBelts(from, to, belt.tier);
    }
  }

  return idMap;
}
