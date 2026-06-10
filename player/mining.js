import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';
import { MINE_RADIUS, MINE_RANGE, TERRAIN_TOOL_RADIUS } from '../constants.js';

// Mining laser beam, particle effects, and per-tool terrain-edit dispatch.
// All functions take `player` as their first argument and mutate its state
// (this._laserMesh, this._laserCurrentLen, this.particles, this._mineTimer,
// this._flattenAnchorR).

export function createLaser(scene) {
  // Mining laser beam — a thin box scaled along Z to match beam length
  const laserGeo = new THREE.BoxGeometry(0.04, 0.04, 1);
  const laserMat = new THREE.MeshBasicMaterial({
    color: 0xff7700,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const laserMesh = new THREE.Mesh(laserGeo, laserMat);
  laserMesh.visible = false;
  scene.add(laserMesh);
  return { laserMesh, laserMat };
}

export function updateLaser(player, origin, direction, length) {
  if (length < 0.05) { player._laserMesh.visible = false; return; }
  player._laserMesh.visible = true;
  // Place midpoint along the beam, scale Z to length
  player._laserMesh.position.copy(origin).addScaledVector(direction, length * 0.5);
  player._laserMesh.scale.set(1, 1, length);
  // Rotate so local +Z aligns with ray direction
  player._laserMesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 0, 1), direction
  );
}

export function spawnParticles(player, hitPos, color) {
  for (let i = 0; i < 5; i++) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 3, 3),
      new THREE.MeshBasicMaterial({ color })
    );
    mesh.position.copy(hitPos);
    const vel = new THREE.Vector3((Math.random()-.5)*5,(Math.random()-.5)*5,(Math.random()-.5)*5);
    player.scene.add(mesh);
    player.particles.push({ mesh, vel, life: 0.4 });
  }
}

export function updateParticles(player, dt) {
  for (let i = player.particles.length - 1; i >= 0; i--) {
    const p = player.particles[i];
    p.life -= dt;
    p.mesh.position.addScaledVector(p.vel, dt);
    p.vel.multiplyScalar(0.82);
    if (p.life <= 0) {
      player.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      player.particles.splice(i, 1);
    }
  }
}

// Mining + laser + terrain-tool dispatch. Called every frame from
// Player.update(). `tool` is one of 'mine' | 'lower' | 'raise' | 'flatten'.
export function updateMining(player, dt, planet, camera, input, inventory, audio, tool) {
  const ray = camera.getRayFromCenter();
  // Offset laser origin to bottom-right of camera so the beam is visible, not hidden inside the view
  const laserOrigin = ray.origin.clone()
    .addScaledVector(camera.getRightDir(), 0.35)
    .addScaledVector(player.up, -0.25);
  player._mineTimer -= dt;
  if (input.isMouseDown(0) && input.pointerLocked) {
    const hit = planet.raycast(ray.origin, ray.direction, MINE_RANGE);
    if (hit) {
      // Grow laser toward hit point at 120 units/sec
      const targetDist = laserOrigin.distanceTo(hit.point);
      player._laserCurrentLen = Math.min(player._laserCurrentLen + 120 * dt, targetDist);
      // Recompute direction from offset origin to hit point
      const laserDir = hit.point.clone().sub(laserOrigin).normalize();
      updateLaser(player, laserOrigin, laserDir, player._laserCurrentLen);

      if (player._mineTimer <= 0) {
        player._mineTimer = player._mineRate;
        const mat = planet.getMaterialAt(hit.point.x, hit.point.y, hit.point.z);

        if (tool === 'mine') {
          planet.mine(hit.point.x, hit.point.y, hit.point.z, MINE_RADIUS, (collected) => {
            for (const [name, count] of Object.entries(collected)) inventory.add(name, count);
          });
          audio.playMine(mat.name);
          spawnParticles(player, hit.point, mat.color);
        } else if (tool === 'lower') {
          // Carves a perfectly radial column straight toward the planet
          // center — each tick lowers the target height a little further.
          planet.lower(hit.point.x, hit.point.y, hit.point.z, TERRAIN_TOOL_RADIUS, (collected) => {
            for (const [name, count] of Object.entries(collected)) inventory.add(name, count);
          });
          audio.playMine(mat.name);
          spawnParticles(player, hit.point, mat.color);
        } else if (tool === 'raise') {
          // Costs 1 Regolith per voxel raised — caps how much can be added
          // based on what the player is carrying. Builds a perfectly radial
          // column straight up from the planet center.
          planet.raise(hit.point.x, hit.point.y, hit.point.z, TERRAIN_TOOL_RADIUS, (needed) => {
            const have = inventory.count('Regolith');
            const used = Math.min(needed, have);
            if (used > 0) inventory.remove('Regolith', used);
            return used;
          });
          audio.playMine('Regolith');
          spawnParticles(player, hit.point, 0xB8A070);
        } else if (tool === 'flatten') {
          // Click-and-hold defines the reference height (radial distance
          // from planet center) at the point first clicked. While held,
          // everything within range flattens toward that height. Releasing
          // clears the anchor so the next click picks a new reference.
          if (player._flattenAnchorR === null) {
            player._flattenAnchorR = Math.sqrt(hit.point.x*hit.point.x + hit.point.y*hit.point.y + hit.point.z*hit.point.z);
          }
          planet.flatten(hit.point.x, hit.point.y, hit.point.z, TERRAIN_TOOL_RADIUS, (collected) => {
            for (const [name, count] of Object.entries(collected)) inventory.add(name, count);
          }, player._flattenAnchorR);
          audio.playMine(mat.name);
          spawnParticles(player, hit.point, mat.color);
        }
      }
    } else {
      // No surface in range — laser sweeps to max range
      player._laserCurrentLen = Math.min(player._laserCurrentLen + 120 * dt, MINE_RANGE);
      updateLaser(player, laserOrigin, ray.direction, player._laserCurrentLen);
    }
  } else {
    // Mouse released — retract laser instantly, and clear the flatten
    // anchor so the next click-and-hold picks a new reference height.
    player._laserCurrentLen = 0;
    player._laserMesh.visible = false;
    player._flattenAnchorR = null;
  }
  updateParticles(player, dt);
}
