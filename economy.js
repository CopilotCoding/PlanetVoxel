import { ALL_ITEMS, MATERIAL_LIST, PROCESSED_ITEMS, TECH_TREE } from './constants.js';

const HISTORY_LEN = 60;

export class Economy {
  constructor(seed) {
    this.seed = seed;
    this.money = 0;
    this.unlocked = new Set(['terminal']); // terminal is free
    this.prices = {};
    this.history = {};
    this.demandSpikes = {};
    this.t = 0;
    this._prng = this._mkrng(seed ^ 0xEC04);

    for (const item of Object.values(ALL_ITEMS)) {
      this.prices[item.name] = item.basePrice;
      this.history[item.name] = new Array(HISTORY_LEN).fill(item.basePrice);
    }
  }

  _mkrng(seed) {
    let s = seed | 0;
    return () => {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  update(dt) {
    this.t += dt;

    // Update prices every 2 seconds (simulated)
    if (Math.floor(this.t / 2) !== Math.floor((this.t - dt) / 2)) {
      for (const item of Object.values(ALL_ITEMS)) {
        const base = item.basePrice;
        const phase = this._prng() * Math.PI * 2;
        const slow = Math.sin(this.t * 0.05 + phase) * 0.25;
        const noise = (this._prng() - 0.5) * 0.1;
        let spike = 1.0;
        if (this.demandSpikes[item.name]) {
          const s = this.demandSpikes[item.name];
          s.remaining -= 2;
          if (s.remaining <= 0) {
            delete this.demandSpikes[item.name];
          } else {
            spike = 2.0;
          }
        }
        // Round to 1 decimal place (not a whole integer) so near-worthless
        // filler like Regolith/Rock (basePrice 0.1) keeps a small non-zero
        // price instead of either rounding to 0 or being floored up to a
        // minimum of 1 like every other item.
        const price = Math.round(base * (1 + slow + noise) * spike * 10) / 10;
        this.prices[item.name] = Math.max(0.1, price);
        const hist = this.history[item.name];
        hist.push(this.prices[item.name]);
        if (hist.length > HISTORY_LEN) hist.shift();
      }

      // Random demand spike — ~1% chance per item per tick
      if (this._prng() < 0.015) {
        const items = Object.values(ALL_ITEMS);
        const item = items[Math.floor(this._prng() * items.length)];
        if (!this.demandSpikes[item.name]) {
          this.demandSpikes[item.name] = { remaining: 30 };
          return { spike: item.name };
        }
      }
    }
    return null;
  }

  getPrice(itemName) {
    return this.prices[itemName] || 0;
  }

  getHistory(itemName) {
    return this.history[itemName] || [];
  }

  hasSpike(itemName) {
    return !!this.demandSpikes[itemName];
  }

  sell(itemName, count) {
    const price = this.getPrice(itemName);
    const total = price * count;
    this.money += total;
    return total;
  }

  spend(amount) {
    if (this.money < amount) return false;
    this.money -= amount;
    return true;
  }

  earn(amount) {
    this.money += amount;
  }

  isUnlocked(techId) {
    return this.unlocked.has(techId);
  }

  canUnlock(techId) {
    const tech = TECH_TREE.find(t => t.id === techId);
    if (!tech) return false;
    if (this.unlocked.has(techId)) return false;
    if (this.money < tech.cost) return false;
    return tech.requires.every(r => this.unlocked.has(r));
  }

  unlock(techId) {
    const tech = TECH_TREE.find(t => t.id === techId);
    if (!tech) return false;
    if (!this.canUnlock(techId)) return false;
    this.money -= tech.cost;
    this.unlocked.add(techId);
    return true;
  }

  isBuildingUnlocked(buildingType) {
    const defs = {
      terminal: true,
      extractor: this.unlocked.has('extractor'),
      crusher: this.unlocked.has('crusher'),
      storage: this.unlocked.has('storage'),
      smelter: this.unlocked.has('smelter'),
      fabricator: this.unlocked.has('fabricator'),
      assembler: this.unlocked.has('assembler'),
      generator: this.unlocked.has('generator'),
      pylon: this.unlocked.has('pylon'),
      sorter: this.unlocked.has('sorter'),
    };
    return !!defs[buildingType];
  }
}
