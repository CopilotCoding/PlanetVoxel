import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';
import { PLANET_RADIUS } from '../constants.js';

// Minimap-only objects (player marker, pole markers) live on this layer so
// they're invisible to the main first-person camera (which stays on the
// default layer 0) but visible to the minimap camera, which enables both
// layer 0 (terrain/buildings) and this layer.
const MINIMAP_LAYER = 1;

// A small top-down 3D minimap: an orthographic camera floating above the
// player, looking straight down along the player's local "up", rotated so
// the player's forward direction always points to the top of the minimap.
// North/south pole markers (world +Y / -Y) are also placed on the minimap
// layer so the player can orient themselves relative to the planet's poles.
export class Minimap {
  constructor(scene) {
    this.scene = scene;

    const VIEW_SIZE = PLANET_RADIUS * 1.1;
    this.camera = new THREE.OrthographicCamera(
      -VIEW_SIZE, VIEW_SIZE, VIEW_SIZE, -VIEW_SIZE, 0.1, PLANET_RADIUS * 4
    );
    this.camera.layers.enable(MINIMAP_LAYER);

    // Player marker — a small bright cone pointing along the player's
    // forward direction, so heading is visible at a glance from above.
    this.playerMarker = new THREE.Mesh(
      new THREE.ConeGeometry(3, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x88ddff, fog: false, depthTest: false, depthWrite: false })
    );
    this.playerMarker.layers.set(MINIMAP_LAYER);
    this.playerMarker.frustumCulled = false;
    // Always draw on top of terrain — when the player is underground, the
    // overlying terrain mesh sits between the top-down minimap camera and
    // the marker and would otherwise occlude it via the depth buffer.
    this.playerMarker.renderOrder = 999;
    scene.add(this.playerMarker);

    // Pole positions — world +Y / -Y (the planet's rotation axis). Drawn as
    // 2D dots clamped to the edge of the minimap overlay (see
    // updatePoleOverlay) rather than as 3D meshes, so they're always visible
    // even when off-screen in the minimap's orthographic view.
    this.northPolePos = new THREE.Vector3(0, PLANET_RADIUS, 0);
    this.southPolePos = new THREE.Vector3(0, -PLANET_RADIUS, 0);
    this.northEl = document.getElementById('minimap-pole-north');
    this.southEl = document.getElementById('minimap-pole-south');
  }

  // playerPos/playerUp: THREE.Vector3 (world position, local up direction).
  // forwardDir: THREE.Vector3, the player's current forward direction
  // (camera.getForwardDir()) — used so "forward" always faces up on the map.
  update(playerPos, playerUp, forwardDir) {
    // Camera sits at a CONSTANT distance from the planet's center, along the
    // direction from center to player — not offset from the player's own
    // (possibly very low, underground) radius. Offsetting from playerPos
    // put the camera inside the planet whenever the player was deep
    // underground (small radius + camDist could still be < planet radius
    // along a different direction). Anchoring to planet-center with a fixed
    // radius keeps the minimap camera outside the planet at all times.
    const camAltitude = PLANET_RADIUS * 2.2;
    this.camera.position.copy(playerUp).multiplyScalar(camAltitude);
    this.camera.up.copy(forwardDir);
    this.camera.lookAt(playerPos);
    this.camera.updateProjectionMatrix();

    // Orient the player marker so its tip points along forwardDir, lying
    // flat on the local tangent plane just above the surface.
    this.playerMarker.position.copy(playerPos).addScaledVector(playerUp, 2);
    const target = playerPos.clone().add(forwardDir).addScaledVector(playerUp, 2);
    this.playerMarker.up.copy(playerUp);
    this.playerMarker.lookAt(target);
    // ConeGeometry points along +Y by default; after lookAt(), local -Z is
    // the direction toward `target` — rotate so the cone's +Y tip points
    // along local -Z instead.
    this.playerMarker.rotateX(Math.PI / 2);

    // Camera-right on the tangent plane: perpendicular to both "up on the
    // minimap" (forwardDir) and the planet-surface normal (playerUp).
    const right = new THREE.Vector3().crossVectors(forwardDir, playerUp).normalize();
    this._updatePoleOverlay(playerPos, playerUp, forwardDir, right);
  }

  // Places each pole marker at the edge of the minimap, in the direction of
  // that pole as seen from directly above the player.
  //
  // Earlier version projected the pole's world position through the camera's
  // view-projection matrix and used the resulting NDC x/y directly. Orthographic
  // projection drops depth entirely, so a pole BEHIND the camera (on the far
  // side of the planet from the player) projects to the SAME x/y as if it were
  // in front — both poles could clamp to the same edge point with no way to
  // tell them apart. Instead, project the pole's direction relative to the
  // player onto the player's own tangent-plane axes (forward/right) — this is
  // depth-free by construction and gives each pole a distinct screen direction
  // (including "pole is behind you", which lands on the opposite edge).
  _updatePoleOverlay(playerPos, playerUp, forwardDir, right) {
    this._placePoleDot(this.northEl, this.northPolePos, playerPos, playerUp, forwardDir, right);
    this._placePoleDot(this.southEl, this.southPolePos, playerPos, playerUp, forwardDir, right);
  }

  _placePoleDot(el, poleWorldPos, playerPos, playerUp, forwardDir, right) {
    if (!el) return;
    const toPole = poleWorldPos.clone().sub(playerPos);
    // Flatten onto the player's local tangent plane (remove the radial/up
    // component) so only the "compass" direction toward the pole remains.
    toPole.addScaledVector(playerUp, -toPole.dot(playerUp));
    if (toPole.lengthSq() < 1e-6) {
      // Directly above/below the player (at a pole) — no defined direction;
      // park at center.
      el.style.left = '50%';
      el.style.top = '50%';
      return;
    }
    toPole.normalize();

    const fy = toPole.dot(forwardDir); // screen "up" component
    const fx = toPole.dot(right);      // screen "right" component

    const RADIUS = 0.92; // clamp radius, leaves a small margin inside the frame border
    const px = (fx * RADIUS * 0.5 + 0.5) * 100;
    const py = (1 - (fy * RADIUS * 0.5 + 0.5)) * 100; // screen-up is CSS-up, so flip y for CSS
    el.style.left = px + '%';
    el.style.top = py + '%';
  }
}
