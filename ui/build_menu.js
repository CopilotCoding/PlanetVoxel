import { BUILDING_DEFS } from '../constants.js';

export class BuildMenu {
  constructor(economy) {
    this.economy = economy;
    this._el = document.getElementById('build-grid');
    this.selectedType = null;
    this._listeners = [];
  }

  onSelect(cb) { this._listeners.push(cb); }

  render() {
    const html = Object.entries(BUILDING_DEFS).map(([type, def]) => {
      const unlocked = this.economy.isBuildingUnlocked(type);
      const selected = this.selectedType === type;
      return `<div class="build-btn ${selected ? 'selected' : ''} ${unlocked ? '' : 'locked-btn'}"
                   data-type="${type}"
                   style="${unlocked ? '' : 'opacity:0.4;cursor:not-allowed'}">
        <span class="build-btn-icon">${def.icon}</span>
        <span class="build-btn-name">${def.name}</span>
        <span class="build-btn-cost">${unlocked ? (def.placeCost > 0 ? `$${def.placeCost}` : 'Free') : '🔒'}</span>
      </div>`;
    }).join('');
    this._el.innerHTML = html;

    this._el.querySelectorAll('.build-btn:not(.locked-btn)').forEach(el => {
      el.addEventListener('click', () => {
        const type = el.dataset.type;
        if (!this.economy.isBuildingUnlocked(type)) return;
        this.selectedType = this.selectedType === type ? null : type;
        this.render();
        for (const cb of this._listeners) cb(this.selectedType);
      });
    });
  }

  clearSelection() {
    this.selectedType = null;
    this.render();
  }
}
