import { TECH_TREE } from '../constants.js';

// Hidden developer console — never linked from any menu/UI. Toggle with
// Ctrl+Shift+` (backquote). Gives unlimited money and unlocks every tech
// tree entry. Not part of the shipped player experience; purely a debug aid.
export class DevConsole {
  constructor(economy, signal) {
    this.economy = economy;
    this._build();

    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'Backquote') {
        e.preventDefault();
        this.toggle();
      }
    }, { signal });
  }

  _build() {
    const el = document.createElement('div');
    el.id = 'dev-console';
    el.style.cssText = `
      position: absolute; top: 16px; left: 50%; transform: translateX(-50%);
      background: rgba(10,10,20,0.92); border: 1px solid #ff44ff;
      border-radius: 6px; padding: 14px 20px; color: #ffccff;
      font-family: monospace; font-size: 13px; z-index: 950;
      display: none; text-align: center; box-shadow: 0 0 20px rgba(255,68,255,0.4);
    `;
    el.innerHTML = `
      <div style="font-weight:bold; margin-bottom:8px; letter-spacing:1px;">DEV CONSOLE</div>
      <button id="dev-money-btn" style="margin:4px; padding:6px 12px; cursor:pointer;">+1,000,000 Money</button>
      <button id="dev-unlock-btn" style="margin:4px; padding:6px 12px; cursor:pointer;">Unlock Everything</button>
      <div style="margin-top:6px; font-size:11px; color:#aa88aa;">Ctrl+Shift+\` to close</div>
    `;
    document.body.appendChild(el);
    this._el = el;

    el.querySelector('#dev-money-btn').addEventListener('click', () => {
      this.economy.earn(1000000);
    });
    el.querySelector('#dev-unlock-btn').addEventListener('click', () => {
      for (const tech of TECH_TREE) this.economy.unlocked.add(tech.id);
    });
  }

  toggle() {
    this._el.style.display = this._el.style.display === 'none' ? 'block' : 'none';
  }
}
