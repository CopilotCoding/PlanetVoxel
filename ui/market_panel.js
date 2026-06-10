import { ALL_ITEMS } from '../constants.js';

export class MarketPanel {
  constructor(economy, inventory, audio) {
    this.economy = economy;
    this.inventory = inventory;
    this.audio = audio;
    this._el = document.getElementById('market-list');
  }

  render() {
    const rows = Object.values(ALL_ITEMS).map(item => {
      const price = this.economy.getPrice(item.name);
      const hist = this.economy.getHistory(item.name);
      const count = this.inventory.count(item.name);
      const hasSpike = this.economy.hasSpike(item.name);
      const color = '#' + item.color.toString(16).padStart(6, '0');
      const sparkline = this._sparkline(hist, color);
      return `
        <div class="item-row" style="${hasSpike ? 'background:rgba(255,100,0,0.1);' : ''}">
          <span class="item-color" style="background:${color}"></span>
          <span class="item-name">${item.name}${hasSpike ? ' ⚡' : ''}</span>
          <span class="item-price">$${price}</span>
          ${count > 0 ? `<span class="item-count">×${count}</span>` : ''}
          ${count > 0 ? `<button class="sell-btn" data-item="${item.name}" data-count="${count}">Sell All</button>` : ''}
        </div>
        ${sparkline}
      `;
    });
    this._el.innerHTML = rows.join('');

    this._el.querySelectorAll('.sell-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.dataset.item;
        const count = parseInt(btn.dataset.count);
        if (this.inventory.remove(name, count)) {
          const earned = this.economy.sell(name, count);
          this.audio.playSell();
        }
        this.render();
      });
    });
  }

  _sparkline(hist, color) {
    const w = 260, h = 36;
    if (hist.length < 2) return '';
    const min = Math.min(...hist), max = Math.max(...hist);
    const range = max - min || 1;
    const pts = hist.map((v, i) => {
      const x = (i / (hist.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      return `${x},${y}`;
    }).join(' ');
    return `<svg width="${w}" height="${h}" style="display:block;opacity:0.6;margin-bottom:6px">
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5"/>
    </svg>`;
  }
}
