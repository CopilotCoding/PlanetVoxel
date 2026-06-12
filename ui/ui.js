import { MarketPanel } from './market_panel.js';
import { TechTree } from './tech_tree.js';
import { FactoryPanel } from './factory_panel.js';
import { BuildMenu } from './build_menu.js';
import { InventoryPanel } from './inventory_panel.js';
import { BuildingPanel } from './building_panel.js';
import { HUD } from './hud.js';

export class UI {
  // `signal` scopes all listeners to this play session — quitting to the
  // menu and starting another world creates a new UI instance, and without
  // this the old instance's toolbar/keyboard listeners would stack on the
  // shared persistent DOM elements and keep responding.
  constructor(economy, inventory, factory, player, audio, signal) {
    this.hud = new HUD(economy, player, inventory);
    this.market = new MarketPanel(economy, inventory, audio);
    this.techTree = new TechTree(economy);
    this.factoryPanel = new FactoryPanel(factory);
    this.buildMenu = new BuildMenu(economy);
    this.inventoryPanel = new InventoryPanel(inventory, economy, audio);
    this.buildingPanel = new BuildingPanel(inventory, audio);

    this._openPanels = new Set();
    this._updateTimer = 0;
    this._signal = signal;
    this._setupToolbar();
    this._setupCloseButtons();
    this._setupKeyboard();
  }

  _setupToolbar() {
    document.querySelectorAll('.toolbar-btn[data-panel]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        this.togglePanel(btn.dataset.panel);
      }, { signal: this._signal });
    });
  }

  _setupCloseButtons() {
    document.querySelectorAll('.panel-close').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        this.closePanel(btn.dataset.panel);
      }, { signal: this._signal });
    });
  }

  _setupKeyboard() {
    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      switch (e.key.toLowerCase()) {
        case 'i': this.togglePanel('inventory-panel'); break;
        case 'm': this.togglePanel('market-panel'); break;
        case 't': this.togglePanel('tech-panel'); break;
        case 'f': this.togglePanel('factory-panel'); break;
        case 'b': this.togglePanel('build-menu'); break;
        case 'escape': this.closeAll(); break;
      }
    }, { signal: this._signal });
  }

  togglePanel(id) {
    const el = document.getElementById(id);
    if (!el) return;
    if (this._openPanels.has(id)) {
      this.closePanel(id);
    } else {
      this.openPanel(id);
    }
  }

  openPanel(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = 'block';
    this._openPanels.add(id);
    this._renderPanel(id);
    document.querySelectorAll(`.toolbar-btn[data-panel="${id}"]`).forEach(b => b.classList.add('active'));
    if (document.pointerLockElement) document.exitPointerLock();
  }

  closePanel(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = 'none';
    this._openPanels.delete(id);
    document.querySelectorAll(`.toolbar-btn[data-panel="${id}"]`).forEach(b => b.classList.remove('active'));
  }

  closeAll() {
    for (const id of [...this._openPanels]) this.closePanel(id);
    this.buildingPanel.close();
  }

  openBuildingPanel(building) {
    if (document.pointerLockElement) document.exitPointerLock();
    this.buildingPanel.open(building);
  }

  _renderPanel(id) {
    switch (id) {
      case 'inventory-panel': this.inventoryPanel.render(); break;
      case 'market-panel':    this.market.render(); break;
      case 'tech-panel':      this.techTree.render(); break;
      case 'factory-panel':   this.factoryPanel.render(); break;
      case 'build-menu':      this.buildMenu.render(); break;
    }
  }

  get buildingSelected() { return this.buildMenu.selectedType; }

  onBuildSelect(cb) { this.buildMenu.onSelect(cb); }

  update(dt) {
    this.hud.update(dt);
    this._updateTimer += dt;
    if (this._updateTimer >= 1.0) {
      this._updateTimer = 0;
      for (const id of this._openPanels) this._renderPanel(id);
      if (this.buildingPanel.isOpen) this.buildingPanel.render();
    }
  }

  showSeed(seed) { this.hud.showSeed(seed); }
  showDemandSpike(name) { this.hud.showDemandSpike(name); }
  setPlacementHint(msg) { this.hud.setPlacementHint(msg); }
  setSelectedTool(index) { this.hud.setSelectedTool(index); }

  anyPanelOpen() { return this._openPanels.size > 0; }
}
