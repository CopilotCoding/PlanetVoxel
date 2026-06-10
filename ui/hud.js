import { PLANET_RADIUS, TOOLS } from '../constants.js';

export class HUD {
  constructor(economy, player, inventory) {
    this.economy = economy;
    this.player = player;
    this.inventory = inventory;
    this._moneyEl = document.getElementById('money-display');
    this._deltaEl = document.getElementById('money-delta');
    this._fuelFill = document.getElementById('fuel-bar-fill');
    this._altitudeEl = document.getElementById('altitude-display');
    this._demandEl = document.getElementById('demand-alert');
    this._seedEl = document.getElementById('seed-display');
    this._hintEl = document.getElementById('placement-hint');
    this._hotbarEl = document.getElementById('hotbar');
    this._lastMoney = 0;
    this._deltaTimer = 0;
    this._deltaVal = 0;
    this._selectedTool = 0;
    this._buildHotbar();
  }

  _buildHotbar() {
    if (!this._hotbarEl) return;
    this._hotbarEl.innerHTML = '';
    this._hotbarSlots = [];
    TOOLS.forEach((tool, i) => {
      const slot = document.createElement('div');
      slot.className = 'hotbar-slot';
      const key = (i + 1) % 10; // slot 10 -> key 0
      slot.innerHTML = `<div class="hotbar-key">${key}</div><div class="hotbar-icon">${tool.icon}</div><div class="hotbar-name">${tool.name}</div>`;
      this._hotbarEl.appendChild(slot);
      this._hotbarSlots.push(slot);
    });
    this.setSelectedTool(0);
  }

  setSelectedTool(index) {
    this._selectedTool = index;
    if (!this._hotbarSlots) return;
    this._hotbarSlots.forEach((slot, i) => slot.classList.toggle('active', i === index));
  }

  showSeed(seed) {
    this._seedEl.textContent = `SEED: ${seed}`;
  }

  update(dt) {
    const money = this.economy.money;
    if (money !== this._lastMoney) {
      const diff = money - this._lastMoney;
      this._deltaVal = diff;
      this._deltaTimer = 1.5;
      this._lastMoney = money;
    }
    this._moneyEl.textContent = `$${Math.floor(money).toLocaleString()}`;

    if (this._deltaTimer > 0) {
      this._deltaTimer -= dt;
      this._deltaEl.style.opacity = Math.min(1, this._deltaTimer).toString();
      const pos = this._deltaVal >= 0;
      this._deltaEl.style.color = pos ? '#00ff88' : '#ff4444';
      this._deltaEl.textContent = (pos ? '+' : '') + Math.floor(this._deltaVal).toLocaleString();
    } else {
      this._deltaEl.style.opacity = '0';
    }

    // Fuel bar
    this._fuelFill.style.width = (this.player.fuelFraction * 100) + '%';

    // Altitude — height above planet center, and depth/height relative to surface
    const r = this.player.position.length();
    const altitude = r - PLANET_RADIUS;
    const sign = altitude >= 0 ? '+' : '';
    this._altitudeEl.textContent = `ALT: ${r.toFixed(1)} (${sign}${altitude.toFixed(1)} from surface)`;
  }

  setPlacementHint(msg) {
    if (!this._hintEl) return;
    this._hintEl.textContent = msg;
    this._hintEl.style.display = msg ? 'block' : 'none';
  }

  showDemandSpike(itemName) {
    this._demandEl.style.display = 'block';
    this._demandEl.textContent = `⚡ DEMAND SPIKE: ${itemName.toUpperCase()} — prices doubled!`;
    setTimeout(() => { this._demandEl.style.display = 'none'; }, 8000);
  }
}
