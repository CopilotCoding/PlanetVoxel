import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';
import { BuildingGhost, BUILDING_HALF_H } from './buildingGhost.js';

// Handles per-frame building placement, moving, belt connection, and the
// demolish/feed/move hints shown while looking at a placed building.
// Encapsulates all the mutable UI-interaction state that previously lived as
// loose locals inside main.js's loop().
export class BuildingInteractions {
  constructor(scene, planet, factory, ui, audio, economy, inventory, camera) {
    this.scene = scene;
    this.planet = planet;
    this.factory = factory;
    this.ui = ui;
    this.audio = audio;
    this.economy = economy;
    this.inventory = inventory;
    this.camera = camera;

    this.ghost = new BuildingGhost(scene);
    this.raycaster = new THREE.Raycaster();
    this.screenCenter = new THREE.Vector2(0, 0);

    this.beltFrom = null;
    this.movingBuilding = null;
    this.buildYaw = 0;

    const beltHighlightMat = new THREE.MeshBasicMaterial({ color: 0xffdd00, wireframe: true });
    this.beltHighlightMat = beltHighlightMat;
    this.beltFromHighlight = null;

    ui.onBuildSelect(() => {
      this.ghost.clear();
      this.buildYaw = 0;
      this.beltFrom = null;
      this._setBeltHighlight(null);
    });
  }

  _setBeltHighlight(building) {
    if (this.beltFromHighlight) { this.scene.remove(this.beltFromHighlight); this.beltFromHighlight = null; }
    if (!building) return;
    const geo = building.mesh.geometry.clone();
    this.beltFromHighlight = new THREE.Mesh(geo, this.beltHighlightMat);
    this.beltFromHighlight.position.copy(building.group.position);
    this.beltFromHighlight.rotation.copy(building.group.rotation);
    this.beltFromHighlight.scale.setScalar(1.12);
    this.scene.add(this.beltFromHighlight);
  }

  // R key rotates placement yaw by 45°. Called once per frame regardless of
  // mode, since both placement and move-mode listen for it.
  _consumeRotate(inputHandler) {
    if (inputHandler.consumeKey('KeyR')) {
      this.buildYaw = (this.buildYaw + Math.PI / 4) % (Math.PI * 2);
    }
  }

  update(inputHandler) {
    const { ui, planet, camera, factory, audio, economy, inventory } = this;
    const selType = ui.buildingSelected;

    if (selType && inputHandler.consumeKey('KeyR')) {
      this.buildYaw = (this.buildYaw + Math.PI / 4) % (Math.PI * 2);
    }

    // Move-building: drag a placed building to a new spot
    if (this.movingBuilding && inputHandler.pointerLocked) {
      this._consumeRotate(inputHandler);
      const ray = camera.getRayFromCenter();
      const hit = planet.raycast(ray.origin, ray.direction, 30);
      if (hit) {
        const surfNorm = planet.surfaceNormal(hit.point).negate();
        const halfH = BUILDING_HALF_H[this.movingBuilding.type] ?? 0.7;
        const placePos = hit.point.clone().addScaledVector(surfNorm, halfH + 0.3);
        this.ghost.update(this.movingBuilding.type, placePos, surfNorm, this.buildYaw);
        ui.setPlacementHint(`Moving ${this.movingBuilding.def.name}  [Right-click] Drop  [R] Rotate  [Esc] Cancel`);
        if (inputHandler.consumeRightClick()) {
          this.movingBuilding.reposition(placePos, surfNorm, this.buildYaw);
          for (const belt of factory.belts) {
            if (belt.from === this.movingBuilding || belt.to === this.movingBuilding) belt.rebuildMesh();
          }
          this.movingBuilding = null;
          this.ghost.clear();
          ui.setPlacementHint('');
          audio.playPlace();
        }
      } else {
        this.ghost.clear();
        ui.setPlacementHint(`Moving ${this.movingBuilding.def.name}  [Right-click] Drop  [R] Rotate  [Esc] Cancel`);
      }
      if (inputHandler.consumeKey('Escape')) {
        this.movingBuilding = null;
        this.ghost.clear();
        ui.setPlacementHint('');
      }
      return;
    }

    // Ghost building preview + placement
    if (selType && inputHandler.pointerLocked) {
      const ray = camera.getRayFromCenter();
      const hit = planet.raycast(ray.origin, ray.direction, 30);
      if (hit) {
        // Use the actual surface normal at the hit point (negated because density
        // gradient points inward into solid — we want the face pointing toward us).
        const surfNorm = planet.surfaceNormal(hit.point).negate();
        const halfH = BUILDING_HALF_H[selType] ?? 0.7;
        const placePos = hit.point.clone().addScaledVector(surfNorm, halfH + 0.3);
        this.ghost.update(selType, placePos, surfNorm, this.buildYaw);
        ui.setPlacementHint(`[Right-click] Place  [R] Rotate (${Math.round(this.buildYaw * 180 / Math.PI)}°)  [Esc] Cancel`);
        if (inputHandler.consumeRightClick()) {
          factory.placeBuilding(selType, placePos, surfNorm, this.buildYaw);
        }
      } else {
        this.ghost.clear();
        ui.setPlacementHint('[Right-click] Place  [R] Rotate  [Esc] Cancel');
      }
      return;
    } else if (!selType && this.ghost.group) {
      this.ghost.clear();
      ui.setPlacementHint('');
    }

    // Belt connection: right-click a building while no build type selected
    if (!selType && inputHandler.pointerLocked) {
      if (inputHandler.consumeRightClick()) {
        this.raycaster.setFromCamera(this.screenCenter, camera.camera);
        const hit = factory.getBuildingAt(this.raycaster);
        if (hit) {
          if (!this.beltFrom) {
            this.beltFrom = hit;
            this._setBeltHighlight(hit);
            ui.setPlacementHint(`Connecting belt FROM ${hit.def.name} — right-click target building`);
          } else if (hit !== this.beltFrom) {
            factory.connectBelts(this.beltFrom, hit);
            audio.playPlace();
            ui.setPlacementHint('Belt connected!');
            setTimeout(() => ui.setPlacementHint(''), 1500);
            this._setBeltHighlight(null);
            this.beltFrom = null;
          }
        } else if (this.beltFrom) {
          // Clicked empty space — cancel belt
          this.beltFrom = null;
          this._setBeltHighlight(null);
          ui.setPlacementHint('');
        }
      }
      // Show hint + demolish when looking at a building
      if (!this.beltFrom && factory.buildings.length > 0) {
        this.raycaster.setFromCamera(this.screenCenter, camera.camera);
        const lookedAt = factory.getBuildingAt(this.raycaster);
        if (lookedAt) {
          ui.setPlacementHint(`${lookedAt.def.name}  [E] Feed inventory  [V] View/Empty  [G] Move  [Right-click] Connect belt  [X] Demolish (+$${Math.floor(lookedAt.def.placeCost * 0.5)} refund)`);
          if (inputHandler.consumeKey('KeyV')) {
            ui.openBuildingPanel(lookedAt);
          }
          if (inputHandler.consumeKey('KeyG')) {
            this.movingBuilding = lookedAt;
            this.buildYaw = lookedAt.yaw;
          }
          if (inputHandler.consumeKey('KeyE')) {
            const fed = factory.feedFromInventory(lookedAt, inventory);
            if (fed.length > 0) {
              ui.setPlacementHint(`Fed ${fed.join(', ')} into ${lookedAt.def.name}`);
              audio.playPlace();
            } else {
              ui.setPlacementHint(`${lookedAt.def.name} can't accept anything you're carrying`);
            }
            setTimeout(() => ui.setPlacementHint(''), 1500);
          }
          if (inputHandler.consumeKey('KeyX')) {
            const refund = Math.floor(lookedAt.def.placeCost * 0.5);
            factory.removeBuilding(lookedAt);
            economy.earn(refund);
            ui.setPlacementHint(`Demolished — refunded $${refund}`);
            setTimeout(() => ui.setPlacementHint(''), 1500);
          }
        } else if (!selType) {
          ui.setPlacementHint('');
        }
      }
    }
  }
}
