import { ALL_ITEMS } from '../constants.js';

// Per-building info panel: shows input/output buffer contents with "Take"
// buttons to empty a backed-up machine into the player's inventory, and —
// for Market Terminals only — a toggleable allow-list of item names the
// terminal will accept (anything else passes through down the belt instead
// of being auto-sold).
export class BuildingPanel {
  constructor(inventory, audio) {
    this.inventory = inventory;
    this.audio = audio;
    this._el = document.getElementById('building-panel-content');
    this._building = null;

    document.getElementById('building-panel-close').addEventListener('click', e => {
      e.stopPropagation();
      this.close();
    });
  }

  open(building) {
    this._building = building;
    document.getElementById('building-panel').style.display = 'block';
    this.render();
  }

  close() {
    this._building = null;
    document.getElementById('building-panel').style.display = 'none';
  }

  get isOpen() {
    return this._building !== null;
  }

  render() {
    const b = this._building;
    if (!b) return;
    let html = `<h3 style="font-size:13px;color:#88aaff;margin-bottom:8px">${b.def.icon} ${b.def.name}</h3>`;

    const inItems = Object.entries(b.inputBuffer).filter(([,v]) => v > 0);
    const outItems = Object.entries(b.outputBuffer).filter(([,v]) => v > 0);

    if (inItems.length === 0 && outItems.length === 0) {
      html += `<div style="color:#555;font-size:12px;margin-bottom:8px">Buffers empty.</div>`;
    } else {
      if (inItems.length > 0) {
        html += `<div style="font-size:11px;color:#888;margin-top:6px">Input buffer</div>`;
        for (const [item, count] of inItems) {
          html += this._itemRow(item, count);
        }
      }
      if (outItems.length > 0) {
        html += `<div style="font-size:11px;color:#888;margin-top:6px">Output buffer</div>`;
        for (const [item, count] of outItems) {
          html += this._itemRow(item, count);
        }
      }
      html += `<button id="building-panel-empty-all" style="margin-top:10px;width:100%;background:rgba(255,150,0,0.15);border:1px solid rgba(255,150,0,0.4);color:#fa0;padding:6px;font-size:12px;cursor:pointer;border-radius:3px;font-family:inherit">Take everything</button>`;
    }

    if (b.type === 'terminal') {
      html += `<div style="font-size:11px;color:#888;margin-top:14px;border-top:1px solid rgba(100,150,255,0.2);padding-top:8px">
        Accepted items (none checked = accept anything)
      </div>`;
      html += `<div class="building-panel-scroll" style="max-height:200px;overflow-y:auto;margin-top:6px">`;
      for (const item of Object.values(ALL_ITEMS)) {
        const checked = b.allowedItems && b.allowedItems.has(item.name) ? 'checked' : '';
        html += `<label style="display:flex;align-items:center;gap:6px;font-size:12px;padding:2px 0;cursor:pointer">
          <input type="checkbox" data-allow-item="${item.name}" ${checked}>
          <span class="item-color" style="background:#${item.color.toString(16).padStart(6,'0')}"></span>
          <span>${item.name}</span>
        </label>`;
      }
      html += `</div>`;
    }

    // Periodic re-renders (every ~1s, see ui.js) rebuild this whole subtree
    // via innerHTML, which resets scroll position to 0 — making it
    // impossible to scroll down the allow-list before it snaps back to the
    // top. Save and restore both the outer panel's and the inner allow-list
    // div's scroll positions across the rebuild.
    const panelEl = document.getElementById('building-panel');
    const prevPanelScroll = panelEl ? panelEl.scrollTop : 0;
    const prevListEl = this._el.querySelector('.building-panel-scroll');
    const prevListScroll = prevListEl ? prevListEl.scrollTop : 0;

    this._el.innerHTML = html;
    this._wireEvents();

    if (panelEl) panelEl.scrollTop = prevPanelScroll;
    const newListEl = this._el.querySelector('.building-panel-scroll');
    if (newListEl) newListEl.scrollTop = prevListScroll;
  }

  _itemRow(item, count) {
    const itemDef = Object.values(ALL_ITEMS).find(i => i.name === item);
    const color = itemDef ? itemDef.color.toString(16).padStart(6, '0') : 'ffffff';
    return `<div class="item-row">
      <span class="item-color" style="background:#${color}"></span>
      <span class="item-name">${item}</span>
      <span class="item-count">${count}</span>
      <button class="sell-btn" data-take-item="${item}">Take</button>
    </div>`;
  }

  _wireEvents() {
    const b = this._building;
    this._el.querySelectorAll('[data-take-item]').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = btn.dataset.takeItem;
        const inCount = b.inputBuffer[item] || 0;
        const outCount = b.outputBuffer[item] || 0;
        if (inCount > 0) { this.inventory.add(item, inCount); delete b.inputBuffer[item]; }
        if (outCount > 0) { this.inventory.add(item, outCount); delete b.outputBuffer[item]; }
        this.audio.playPlace();
        this.render();
      });
    });

    const emptyAllBtn = this._el.querySelector('#building-panel-empty-all');
    if (emptyAllBtn) {
      emptyAllBtn.addEventListener('click', () => {
        b.emptyInto(this.inventory);
        this.audio.playPlace();
        this.render();
      });
    }

    this._el.querySelectorAll('[data-allow-item]').forEach(cb => {
      cb.addEventListener('change', () => {
        const name = cb.dataset.allowItem;
        if (!b.allowedItems) b.allowedItems = new Set();
        if (cb.checked) b.allowedItems.add(name);
        else b.allowedItems.delete(name);
      });
    });
  }
}
