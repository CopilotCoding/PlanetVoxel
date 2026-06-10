import { ALL_ITEMS } from '../constants.js';

export class InventoryPanel {
  constructor(inventory, economy, audio) {
    this.inventory = inventory;
    this.economy = economy;
    this.audio = audio;
    this._el = document.getElementById('inventory-list');
  }

  render() {
    const entries = this.inventory.sortedEntries();
    if (entries.length === 0) {
      this._el.innerHTML = '<div style="color:#555;font-size:12px">Empty</div>';
      return;
    }
    this._el.innerHTML = entries.map(e => {
      const color = '#' + e.item.color.toString(16).padStart(6, '0');
      const price = this.economy.getPrice(e.name);
      return `<div class="item-row">
        <span class="item-color" style="background:${color}"></span>
        <span class="item-name">${e.name}</span>
        <span class="item-count">×${e.count}</span>
        <span class="item-price">$${price}</span>
        <button class="sell-btn" data-item="${e.name}" data-count="${e.count}">Sell</button>
      </div>`;
    }).join('');

    this._el.querySelectorAll('.sell-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.dataset.item;
        const count = parseInt(btn.dataset.count);
        if (this.inventory.remove(name, count)) {
          this.economy.sell(name, count);
          this.audio.playSell();
        }
        this.render();
      });
    });
  }
}
