export class FactoryPanel {
  constructor(factory) {
    this.factory = factory;
    this._el = document.getElementById('factory-list');
  }

  render() {
    const buildings = this.factory.buildings;
    if (buildings.length === 0) {
      this._el.innerHTML = '<div style="color:#555;font-size:12px">No buildings placed yet.</div>';
      return;
    }

    const summary = this.factory.getStatusSummary();
    let html = `<div style="font-size:11px;color:#888;margin-bottom:8px">
      <span style="color:#0c6">▪ ${summary.running||0} running</span>
      <span style="color:#fa0"> ▪ ${summary.starved||0} starved</span>
      <span style="color:#f44"> ▪ ${summary.blocked||0} blocked</span>
      <span style="color:#888"> ▪ ${summary.unpowered||0} unpowered</span>
    </div>`;

    for (const b of buildings) {
      const outItems = Object.entries(b.outputBuffer).filter(([,v]) => v > 0);
      const inItems = Object.entries(b.inputBuffer).filter(([,v]) => v > 0);
      html += `<div class="item-row" style="flex-direction:column;align-items:flex-start;padding:6px 0">
        <div style="display:flex;justify-content:space-between;width:100%;align-items:center">
          <span style="font-size:12px;font-weight:bold">${b.def.icon} ${b.def.name}</span>
          <span class="building-status status-${b.status}">${b.status}</span>
        </div>
        ${inItems.length > 0 ? `<div style="font-size:10px;color:#888;margin-top:2px">In: ${inItems.map(([k,v])=>`${k}×${v}`).join(', ')}</div>` : ''}
        ${outItems.length > 0 ? `<div style="font-size:10px;color:#aac;margin-top:2px">Out: ${outItems.map(([k,v])=>`${k}×${v}`).join(', ')}</div>` : ''}
        <div style="font-size:10px;color:#556;margin-top:2px">~${b.throughput.toFixed(2)} items/s</div>
      </div>`;
    }

    this._el.innerHTML = html;
  }
}
