import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';

export class Camera {
  // Pass an AbortSignal so the resize listener is removed when the play
  // session ends (quitting to menu disposes `renderer`, which would
  // otherwise still be referenced by a stale resize handler).
  constructor(renderer, signal) {
    this.camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.3, 2000);
    this.yaw   = 0;
    this.pitch = 0;
    this._fwd     = new THREE.Vector3(0, 0, -1);
    this._right   = new THREE.Vector3(1, 0, 0);
    this._up      = new THREE.Vector3(0, 1, 0);
    this._lookDir = new THREE.Vector3(0, 0, -1);
    // Persistent "north" tangent vector — parallel-transported each frame to avoid
    // any discontinuity when up crosses the (0,1,0) axis.
    this._north = new THREE.Vector3(0, 0, -1);

    // Smoothed radial (altitude) distance from the planet center, used for
    // the camera's eye height only. On steep slopes the player's physics
    // position can still take small residual steps as it crosses
    // marching-cubes mesh facets — these are too small to affect gameplay
    // but visible as camera jitter since the camera sits rigidly at a fixed
    // eye height above the body. Lerping only the vertical/radial component
    // of the camera position smooths out that residual jitter without
    // adding any lag to horizontal look/turn/strafe response.
    this._smoothAltitude = null;

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    }, { signal });
  }

  rotate(dx, dy) {
    this.yaw   += dx * 0.002;
    this.pitch -= dy * 0.002;
    this.pitch  = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, this.pitch));
  }

  update(playerPos, playerUp) {
    const up = playerUp.clone().normalize();
    this._up.copy(up);

    // Parallel-transport _north: remove its component along the new up vector,
    // then renormalize. This smoothly rotates the tangent frame as the player
    // walks around the sphere with zero discontinuity at any point.
    this._north.addScaledVector(up, -this._north.dot(up));
    if (this._north.lengthSq() < 1e-8) {
      // Degenerate (shouldn't happen in practice) — pick an arbitrary perpendicular.
      const arb = Math.abs(up.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
      this._north.crossVectors(up, arb);
    }
    this._north.normalize();

    const baseRight = new THREE.Vector3().crossVectors(this._north, up).normalize();
    const baseFwd   = this._north.clone(); // snapshot; _north must not be modified below

    // Apply yaw (rotate around local up)
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const yawFwd   = baseFwd.clone().multiplyScalar(cy).addScaledVector(baseRight, sy);
    const yawRight = baseRight.clone().multiplyScalar(cy).addScaledVector(baseFwd.clone().negate(), sy);

    this._fwd.copy(yawFwd);
    this._right.copy(yawRight);

    // Apply pitch for look direction
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this._lookDir.copy(yawFwd).multiplyScalar(cp).addScaledVector(up, sp).normalize();

    // Position camera at player eye level
    const EYE = 1.55;
    const eyePos = playerPos.clone().addScaledVector(up, EYE);

    // Smooth only the radial distance (altitude) of the eye position — the
    // horizontal/tangential position tracks the player exactly (no input
    // lag), but small frame-to-frame altitude steps from slope-mesh
    // faceting are blended out over a few frames.
    const altitude = eyePos.length();
    if (this._smoothAltitude === null) this._smoothAltitude = altitude;
    this._smoothAltitude += (altitude - this._smoothAltitude) * 0.3;
    eyePos.setLength(this._smoothAltitude);

    this.camera.position.copy(eyePos);
    this.camera.up.copy(up);
    this.camera.lookAt(eyePos.clone().add(this._lookDir));
  }

  getForwardDir() { return this._fwd.clone(); }
  getRightDir()   { return this._right.clone(); }
  getLookDir()    { return this._lookDir.clone(); }

  getRayFromCenter() {
    return {
      origin:    this.camera.position.clone(),
      direction: this._lookDir.clone(),
    };
  }
}
