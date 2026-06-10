import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';
import { ISO_LEVEL } from '../constants.js';

// Player collision cylinder — radius matches the visual mesh, height spans
// from feet (0) to just above the camera/head.
export const COLLIDER_RADIUS = 0.32;
export const COLLIDER_HEIGHT = 1.8;
export const COLLIDER_RING_POINTS = 6; // points sampled around the cylinder at each height

// Push the player out of solid geometry using a full cylinder collider:
// a ring of points around the bottom (feet), a ring around the top (head),
// and the two axis endpoints. Runs every frame — prevents clipping through
// walls/floors/ceilings/overhangs from any direction, regardless of which
// way the player is moving.
export function pushOutOfSolid(player, planet, up) {
  // Build a tangent basis perpendicular to `up` for placing ring points
  const arb = Math.abs(up.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  const tangentA = new THREE.Vector3().crossVectors(up, arb).normalize();
  const tangentB = new THREE.Vector3().crossVectors(up, tangentA).normalize();

  // Bottom — single point at the feet (no ring). snapToGround owns
  // resting-on-surface behaviour; this point just catches the player
  // being shoved into solid ground from below/sideways.
  resolvePointCollision(player, planet, up, player.position.clone(), 0);

  // Top — full ring, as before, for head/shoulder clearance against
  // ceilings and overhangs.
  const topCenter = player.position.clone().addScaledVector(up, COLLIDER_HEIGHT);
  resolvePointCollision(player, planet, up, topCenter, COLLIDER_HEIGHT);
  for (let i = 0; i < COLLIDER_RING_POINTS; i++) {
    const angle = (i / COLLIDER_RING_POINTS) * Math.PI * 2;
    const offset = tangentA.clone().multiplyScalar(Math.cos(angle) * COLLIDER_RADIUS)
      .addScaledVector(tangentB, Math.sin(angle) * COLLIDER_RADIUS);
    const ringPoint = topCenter.clone().add(offset);
    resolvePointCollision(player, planet, up, ringPoint, COLLIDER_HEIGHT);
  }
}

// Resolve a collision at `samplePoint`. If samplePoint is offset from
// player.position by `offset` along `up` (i.e. it's the head check), the
// computed push is applied to player.position directly so the whole player
// (feet+head) moves together out of the ceiling.
function resolvePointCollision(player, planet, up, samplePoint, offset) {
  const pos = player.position;
  const d0 = planet.density(samplePoint.x, samplePoint.y, samplePoint.z);
  if (d0 <= ISO_LEVEL) return;
  // For the foot point, snapToGround owns resting-on-ground — it already
  // keeps the feet right at the surface every frame, based on a ring of
  // probes around the player. The single center foot point checked here can
  // land at a very slightly different depth than that ring's consensus
  // (especially on slopes, where sub-voxel facets differ from point to
  // point), so a low threshold here fights snapToGround every frame: this
  // pushes up a hair, snapToGround pulls down a hair, repeat — a rapid,
  // tiny vibration on slopes. Only step in here for *real* penetration
  // (e.g. spawning inside terrain or getting shoved into a wall) —
  // snapToGround handles all normal ground contact.
  if (offset === 0 && d0 - ISO_LEVEL < 0.5) return;

  // Near the planet's exact center, the density field d = (PLANET_RADIUS - r)
  // + ... has a gradient that's discontinuous at r=0 (a cone tip) — finite
  // differences there return an essentially arbitrary direction that changes
  // wildly frame to frame. If the player ever ends up buried in solid rock
  // at the core, that unstable gradient becomes the push direction every
  // frame, yanking position/velocity in a different direction each time —
  // the "stuck in place, flipping rapidly" bug. Below this radius, skip the
  // gradient entirely and push along the (now-stable, frozen) `up` axis.
  const CENTER_DEAD_ZONE = 0.5;
  let px, py, pz;
  if (samplePoint.length() < CENTER_DEAD_ZONE) {
    px = up.x; py = up.y; pz = up.z;
  } else {
    const eps = 0.4;
    const gx = planet.density(samplePoint.x+eps,samplePoint.y,samplePoint.z) - planet.density(samplePoint.x-eps,samplePoint.y,samplePoint.z);
    const gy = planet.density(samplePoint.x,samplePoint.y+eps,samplePoint.z) - planet.density(samplePoint.x,samplePoint.y-eps,samplePoint.z);
    const gz = planet.density(samplePoint.x,samplePoint.y,samplePoint.z+eps) - planet.density(samplePoint.x,samplePoint.y,samplePoint.z-eps);
    const glen = Math.sqrt(gx*gx + gy*gy + gz*gz);

    // Push along negative gradient (toward open space); fall back to planet-up
    px = glen > 0.001 ? -gx/glen : up.x;
    py = glen > 0.001 ? -gy/glen : up.y;
    pz = glen > 0.001 ? -gz/glen : up.z;
  }

  // Coarse scan for approximate exit distance
  let exitD = -1;
  for (let d = 0.05; d <= 4; d += 0.05) {
    if (planet.density(samplePoint.x+px*d, samplePoint.y+py*d, samplePoint.z+pz*d) <= ISO_LEVEL) { exitD = d; break; }
  }
  if (exitD < 0) return; // fully buried — give up this frame

  // Binary search for exact surface along push direction (eliminates coarse-step jitter)
  let lo = exitD - 0.05, hi = exitD;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) * 0.5;
    if (planet.density(samplePoint.x+px*mid, samplePoint.y+py*mid, samplePoint.z+pz*mid) > ISO_LEVEL) lo = mid; else hi = mid;
  }
  const fd = hi + 0.01;

  // On gentle slopes, push straight along `up` instead of along the
  // surface normal — prevents the foot point from nudging the player
  // down-slope every frame ("icy" sliding) on normal terrain. Steep
  // slopes/peaks (where push direction is far from `up`) keep the full
  // normal-direction push, so sliding off cliffs/peaks is preserved.
  const pushDotUp = up.x*px + up.y*py + up.z*pz;
  if (offset === 0 && pushDotUp > 0.5) {
    // Damp this correction the same way snapToGround does. Without damping,
    // once foot penetration crosses the 0.5 threshold above, this applies
    // the FULL `fd` correction instantly — a visible teleport on steep
    // uphill slopes where penetration can build up past 0.5 in a burst.
    pos.addScaledVector(up, fd * 0.35);
  } else {
    pos.x += px*fd; pos.y += py*fd; pos.z += pz*fd;
  }

  // Kill velocity component pointing back into the surface
  const vDotP = player._velH.x*px + player._velH.y*py + player._velH.z*pz;
  if (vDotP < 0) { player._velH.x -= px*vDotP; player._velH.y -= py*vDotP; player._velH.z -= pz*vDotP; }
  // For the head check, an upward push direction means a low ceiling —
  // also kill upward vertical velocity so the player stops rising into it.
  if (player._velVert < 0 && pushDotUp > 0.3) player._velVert = 0;
  if (offset > 0 && player._velVert > 0 && pushDotUp < -0.3) player._velVert = 0;
}

// Snap player to the ground surface when grounded or falling.
// Not called while rising — prevents magnetic ground snap on small jumps.
// Casts a ring of straight-down probes around the base of the collider
// (not just through the center) so walking up slopes/uphills doesn't
// flicker grounded/airborne when the center probe momentarily clears the
// surface but the player's feet are clearly still on it.
export function snapToGround(player, planet, up) {
  const pos = player.position;
  // MAX bounds how far below `pos` the probe searches for ground, which in
  // turn caps the per-frame uphill correction AND, now that the correction
  // below is a full (undamped) snap, the maximum single-frame downward
  // teleport when falling/jumping and landing within MAX of the ground.
  // 1.0 made landings from a jump/fall snap the player down a full meter
  // instantly. A small MAX still tracks uphill slopes fine at normal walking
  // speed (the average-of-7-probes target moves continuously frame to frame
  // regardless of MAX) while keeping any landing snap imperceptibly small.
  const MAX = 0.3;

  // If the player is buried deep in solid rock (not just standing right at
  // a surface), there's no nearby surface to snap to — every probe in the
  // ring stays solid across the full [0,MAX] range, so the binary search
  // converges to ~MAX with no real transition, pulling the player further
  // into the rock by ~MAX every single frame. Combined with gravity/jetpack
  // pushing back the other way, this oscillates position back and forth
  // every frame — the rapid "vibrating" bug at the planet core (which is
  // solid rock for tens of units in every direction). Bail out and treat
  // the player as airborne instead.
  if (planet.density(pos.x, pos.y, pos.z) > ISO_LEVEL + 5) {
    player.grounded = false;
    return;
  }

  const arb = Math.abs(up.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  const tangentA = new THREE.Vector3().crossVectors(up, arb).normalize();
  const tangentB = new THREE.Vector3().crossVectors(up, tangentA).normalize();

  const ringR = COLLIDER_RADIUS * 0.85;
  const origins = [new THREE.Vector3(0, 0, 0)];
  for (let i = 0; i < COLLIDER_RING_POINTS; i++) {
    const angle = (i / COLLIDER_RING_POINTS) * Math.PI * 2;
    origins.push(
      tangentA.clone().multiplyScalar(Math.cos(angle) * ringR)
        .addScaledVector(tangentB, Math.sin(angle) * ringR)
    );
  }

  let sitSum = 0, sitCount = 0, anyGrounded = false;
  for (const offset of origins) {
    const bx = pos.x + offset.x, by = pos.y + offset.y, bz = pos.z + offset.z;
    if (planet.density(bx - up.x*MAX, by - up.y*MAX, bz - up.z*MAX) <= ISO_LEVEL) continue;
    anyGrounded = true;
    let lo = 0, hi = MAX;
    for (let i = 0; i < 10; i++) {
      const mid = (lo + hi) * 0.5;
      const mx = bx - up.x*mid, my = by - up.y*mid, mz = bz - up.z*mid;
      if (planet.density(mx, my, mz) > ISO_LEVEL) hi = mid; else lo = mid;
    }
    sitSum += lo;
    sitCount++;
  }

  if (anyGrounded) {
    // Using the MAX across the 7 ring probes (the old approach) means the
    // measurement jumps discretely whenever a *different* probe becomes the
    // deepest one as the player's footprint shifts onto new terrain each
    // frame — even on a perfectly smooth slope. The AVERAGE across all
    // probes that found ground changes continuously instead, since it's a
    // smooth blend of all 7 samples rather than a discrete argmax switch.
    //
    // With a continuous target, a FULL snap to it every frame (no damping)
    // is exactly how downhill movement already feels smooth: gravity moves
    // the player continuously, and snapping fully to a continuously-moving
    // ground height each frame tracks it without any visible steps. The old
    // damped partial correction (`-sit*0.35`) was needed to hide a jagged
    // measurement — with a smooth measurement it's no longer needed, and
    // removing it removes the residual "tiny teleport" stutter from the
    // correction lagging behind (and overshooting/oscillating around) the
    // true ground height frame to frame.
    const sit = (sitSum / sitCount) - 0.01;
    pos.addScaledVector(up, -sit);
    player._velVert = 0;
    player.grounded = true;
  } else {
    player.grounded = false;
  }
}
