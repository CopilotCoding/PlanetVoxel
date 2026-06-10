import { ALL_ITEMS } from './constants.js';

export class Inventory {
  constructor() {
    this.items = {};
  }

  add(itemName, count = 1) {
    this.items[itemName] = (this.items[itemName] || 0) + count;
  }

  remove(itemName, count = 1) {
    if (!this.has(itemName, count)) return false;
    this.items[itemName] -= count;
    if (this.items[itemName] <= 0) delete this.items[itemName];
    return true;
  }

  has(itemName, count = 1) {
    return (this.items[itemName] || 0) >= count;
  }

  count(itemName) {
    return this.items[itemName] || 0;
  }

  total() {
    return Object.values(this.items).reduce((a, b) => a + b, 0);
  }

  all() {
    return { ...this.items };
  }

  // Returns array of { name, count, item } sorted by value desc
  sortedEntries() {
    const entries = [];
    for (const [name, count] of Object.entries(this.items)) {
      const item = Object.values(ALL_ITEMS).find(i => i.name === name);
      if (item) entries.push({ name, count, item });
    }
    entries.sort((a, b) => b.item.basePrice - a.item.basePrice);
    return entries;
  }
}
