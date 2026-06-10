import { TECH_TREE } from '../constants.js';

export class TechTree {
  constructor(economy) {
    this.economy = economy;
    this._el = document.getElementById('tech-list');
  }

  render() {
    const byTier = {};
    for (const node of TECH_TREE) {
      if (!byTier[node.tier]) byTier[node.tier] = [];
      byTier[node.tier].push(node);
    }

    let html = '';
    for (const tier of [1,2,3,4]) {
      if (!byTier[tier]) continue;
      html += `<div style="font-size:11px;color:#666;margin:8px 0 4px;letter-spacing:2px">TIER ${tier}</div>`;
      for (const node of byTier[tier]) {
        const unlocked = this.economy.isUnlocked(node.id);
        const available = this.economy.canUnlock(node.id);
        let cls = 'tech-node locked';
        if (unlocked) cls = 'tech-node unlocked';
        else if (available) cls = 'tech-node available';

        const prereqNames = node.requires.map(r => {
          const found = TECH_TREE.find(t => t.id === r);
          return found ? found.name : r;
        }).join(', ');

        html += `<div class="${cls}" data-id="${node.id}">
          <div class="tech-node-name">${node.name} ${unlocked ? '✓' : ''}</div>
          <div class="tech-node-cost">${unlocked ? 'UNLOCKED' : `$${node.cost.toLocaleString()}`}</div>
          <div class="tech-node-desc">${node.desc}${prereqNames ? ` <span style="color:#555">· needs: ${prereqNames}</span>` : ''}</div>
        </div>`;
      }
    }
    this._el.innerHTML = html;

    this._el.querySelectorAll('.tech-node.available').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        if (this.economy.unlock(id)) {
          this.render();
        }
      });
    });
  }
}
