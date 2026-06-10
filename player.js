import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';
import {
  PLANET_RADIUS, ATMOSPHERE_RADIUS, PLAYER_SPEED, JUMP_FORCE, GRAVITY,
  JETPACK_FORCE, JETPACK_MAX_FUEL, JETPACK_REGEN_RATE, JETPACK_CONSUME_RATE,
  ISO_LEVEL
} from './constants.js';
import { pushOutOfSolid, snapToGround } from './player/collision.js';
import { createLaser, updateMining } from './player/mining.js';

export class Player {
  constructor(scene, planet) {
    this.scene  = scene;
    this.planet = planet;
    this.position  = new THREE.Vector3(0, PLANET_RADIUS + 4, 0);
    this.up        = new THREE.Vector3(0, 1, 0);
    this._velVert  = 0;
    this._velH     = new THREE.Vector3();
    this.grounded  = false;
    this.fuel      = JETPACK_MAX_FUEL;
    this.jetpackActive = false;
    this._mineTimer = 0;
    this._mineRate  = 0.12;
    this._flattenAnchorR = null;
    this.particles  = [];
    this.velocity   = new THREE.Vector3();

    const { laserMesh, laserMat } = createLaser(scene);
    this._laserMesh = laserMesh;
    this._laserMat = laserMat;
    this._laserCurrentLen = 0; // animated length, grows toward target distance

    this.mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 1.0, 8),
      new THREE.MeshLambertMaterial({ color: 0x4488ff })
    );
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  update(dt, input, camera, inventory, audio, economy, tool = 'mine') {
    const planet = this.planet;
    const pos    = this.position;

    // Jetpack tech tree upgrades
    const fuelMult  = economy && economy.isUnlocked('jetpack_fuel')   ? 2.0 : 1.0;
    const forceMult = economy && economy.isUnlocked('jetpack_thrust') ? 1.6 : 1.0;
    const maxFuel   = JETPACK_MAX_FUEL * fuelMult;
    const jetForce  = JETPACK_FORCE * forceMult;
    this._maxFuel   = maxFuel;

    this.up.copy(pos).normalize();
    const up    = this.up;
    const fwd   = camera.getForwardDir();
    const right = camera.getRightDir();

    // Horizontal input
    const moveVec = new THREE.Vector3();
    if (input.isDown('KeyW') || input.isDown('ArrowUp'))    moveVec.addScaledVector(fwd,    1);
    if (input.isDown('KeyS') || input.isDown('ArrowDown'))  moveVec.addScaledVector(fwd,   -1);
    if (input.isDown('KeyA') || input.isDown('ArrowLeft'))  moveVec.addScaledVector(right, -1);
    if (input.isDown('KeyD') || input.isDown('ArrowRight')) moveVec.addScaledVector(right,  1);

    const jetKey = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    const flying = !this.grounded;

    if (moveVec.lengthSq() > 0.001) {
      moveVec.projectOnPlane(up).normalize();
      if (flying) {
        // Airborne: movement keys are thrust (acceleration), not a velocity
        // target — this lets momentum build up and carry into a glide.
        const accel = (jetKey ? jetForce : GRAVITY * 0.6);
        this._velH.addScaledVector(moveVec, accel * dt);
      } else {
        moveVec.multiplyScalar(PLAYER_SPEED);
        this._velH.lerp(moveVec, 0.18); // smoother acceleration — less jerky in tunnels
      }
    } else if (!flying) {
      this._velH.multiplyScalar(0.7); // less abrupt stop on ground
      if (this._velH.lengthSq() < 0.0004) this._velH.set(0, 0, 0); // fully stop — avoid residual creep/jitter
    }

    if (flying) {
      // Atmospheric drag only applies below the atmosphere ceiling — once
      // the player climbs above it, momentum is fully conserved and they
      // can orbit. Inside the atmosphere, light drag bleeds off speed.
      if (pos.length() < ATMOSPHERE_RADIUS) {
        this._velH.multiplyScalar(0.997);
      }
      const maxFlySpeed = PLAYER_SPEED * 3.0;
      if (this._velH.length() > maxFlySpeed) this._velH.normalize().multiplyScalar(maxFlySpeed);
    } else {
      if (this._velH.length() > PLAYER_SPEED) this._velH.normalize().multiplyScalar(PLAYER_SPEED);
    }

    // Gravity — only when airborne, and not while buried deep in solid rock.
    // "Falling toward the planet" is meaningless when already encased in
    // rock (e.g. a player who ends up at the planet's core, where it's
    // solid for tens of units in every direction) — gravity there just
    // pins them in place against the jetpack with barely enough net thrust
    // to escape before fuel runs out. Suspending gravity while buried lets
    // jetpack thrust alone carry them back to open space, where normal
    // gravity resumes.
    const buried = planet.density(pos.x, pos.y, pos.z) > ISO_LEVEL + 5;
    // Zero-g zone near the planet's exact center — a deep tunnel can lead
    // all the way to pos.length()≈0, where `up = pos.normalize()` becomes a
    // direction that's essentially noise (tiny position changes flip it
    // wildly). Gravity along an unstable axis turns that instability into
    // visible jitter every frame. Suspending gravity within this radius
    // means there's no force amplifying the wobble — the player just
    // floats freely through the core, however `up` happens to be oriented.
    const ZERO_G_RADIUS = 30;
    const zeroG = pos.length() < ZERO_G_RADIUS;
    if (this.grounded || buried || zeroG) {
      this._velVert = 0;
    } else {
      this._velVert -= GRAVITY * dt;
    }

    // Jump — sets grounded=false so ground raycast won't re-land this frame
    if (input.isDown('Space') && this.grounded) {
      this._velVert = JUMP_FORCE;
      this.grounded = false;
    }

    // Jetpack — adds vertical thrust as acceleration. Combined with the
    // momentum-based horizontal flight above, releasing Shift mid-flight
    // lets the player coast/glide on existing momentum instead of stopping.
    if (jetKey && this.fuel > 0) {
      this.jetpackActive = true;
      this.fuel = Math.max(0, this.fuel - JETPACK_CONSUME_RATE * dt);
      this._velVert += jetForce * dt;
      const maxVert = jetForce * 1.5;
      this._velVert = Math.min(this._velVert, maxVert);
      this.grounded = false;
      audio.playJetpack(true);
    } else {
      this.jetpackActive = false;
      if (!jetKey) this.fuel = Math.min(maxFuel, this.fuel + JETPACK_REGEN_RATE * fuelMult * dt);
    }

    // Integrate horizontal then vertical
    pos.addScaledVector(this._velH, dt);
    pos.addScaledVector(up, this._velVert * dt);

    // Pass 1 — always push out of solid geometry regardless of movement direction.
    // This prevents clipping through walls while rising, jetting, or moving sideways.
    pushOutOfSolid(this, planet, up);

    // Pass 2 — surface following: only snap to ground when grounded or falling.
    // Skipping this while rising prevents the magnetic ground-snap on small jumps.
    if (this.grounded || this._velVert < 0) {
      snapToGround(this, planet, up);
    } else {
      this.grounded = false;
    }

    this.velocity.copy(this._velH).addScaledVector(up, this._velVert);

    // Safety — only stops the player drifting off into deep space; set well
    // beyond the atmosphere so it never interferes with orbiting.
    const MAX_ALTITUDE = PLANET_RADIUS * 4;
    if (pos.length() > MAX_ALTITUDE) {
      pos.normalize().multiplyScalar(MAX_ALTITUDE);
      if (this._velVert > 0) this._velVert = 0;
    }


    // Mining + laser + terrain-tool dispatch
    updateMining(this, dt, planet, camera, input, inventory, audio, tool);
  }

  get fuelFraction() { return this.fuel / (this._maxFuel || JETPACK_MAX_FUEL); }
}
