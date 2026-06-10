# Planet Voxel

A browser-based voxel planet mining and factory automation game, in the vein
of Astroneer + Satisfactory. You spawn on a small fully-destructible planet
with smooth marching-cubes terrain, mine raw materials with a pickaxe and
terrain-shaping tools (mine/raise/lower/flatten), sell ore for cash, and use
that cash to build an automated factory: extractors, crushers, smelters,
fabricators, assemblers, conveyor belts, storage, power generators/pylons, and
sorters, all chained together to produce higher-value goods and sell them at
a market terminal. There's a day/night cycle, a jetpack, caves, and a tech
tree gating which buildings/recipes you've unlocked.

Vanilla JS ES modules, Three.js, marching cubes terrain — no build step
required.

## The three headaches (lessons learned the hard way)

These ate the most debugging time across the project and are worth knowing
before touching the related code:

1. **The sun must be a `PointLight`, not a `DirectionalLight`.** A
   directional sun lit the *inside* of caves and tunnels too, because
   `DirectionalLight` has no occlusion concept without shadow maps — and
   shadow maps brought their own black-cloud artifacts that blocked the
   player's lantern. Switching to a `PointLight` at the sun's position
   (`decay=0`, `distance=0`) fixed everything at once: tunnel walls face
   inward and naturally get zero light, no shadow maps needed. ~20 wasted
   attempts before landing on this.

2. **Underground/cave detection needs a real upward raycast, not a few fixed
   height samples.** The original detector checked density at 3 fixed
   heights above the player and required all three to be solid — broken in
   most cave shapes. Worse, the bug was *masked* on the night side of the
   planet because the lantern logic also turns on the lantern when
   `dayDot < 0`, regardless of whether "underground" was detected correctly.
   So "it works at night" was a false positive. Fixed by stepping a raycast
   straight up from the player (1 to 30 units) and checking for any solid
   voxel (a ceiling) along the way.

3. **Tool-flattened/raised/lowered terrain caused huge walking hops.**
   Marching cubes only samples the density field at integer lattice points,
   where the terrain-tool math was already exact and flat. But the player's
   collision probes sample density at *continuous* positions — and the old
   density function applied the full ±28-amplitude noise field there, only
   shifted by a flat per-voxel constant. Between lattice points this is very
   much NOT flat, so walking across "flattened" ground produced large visible
   hops. Fixed with a separate `_shellTargetR` map: voxels fully snapped by
   raise/lower/flatten store their target radius, and `density()` returns the
   exact shell formula `ISO_LEVEL + (targetR - r)` for any continuous query
   near them, bypassing noise entirely. A first attempt that tried to do this
   for *all* overrides (including mining) caused fall-through bugs on deep
   terrain — scoping it to only fully-flattened voxels was the fix.

## Running locally

This is a static site — any local HTTP server works. From the project root:

```
python -m http.server
```

Then open http://localhost:8000 in your browser.

Alternatively, with Node.js installed:

```
npx serve .
```

### If your changes don't seem to take effect

This has happened **twice** — both times wasted a full debugging session on
a "bug" that was never in the code:

- **First time:** an old `python -m http.server` (or similar) process kept
  running in the background on a port the browser was no longer pointed at,
  so every hard-reload (Ctrl+Shift+R) was correctly fetching files — just from
  the wrong, stale server. Spent 10+ iterations rewriting `terrain/density.js`
  and `terrain/march.js` (removing/re-adding the cave system, removing
  craters, adding debug overlays) chasing "worm cracks with invisible-dirt
  collision" that didn't exist in the running code at all.

- **Second time:** the same thing, again — a "tunnels are completely
  invisible, fell through into nothing" report turned out to be the exact same
  stale-port issue, not a real meshing/rendering bug.

The pattern: code fixes appear to have **zero visible effect**, including ones
that are actually correct, no matter how many times you hard-reload.

If a fix has zero visible effect despite a hard reload: **don't** keep
re-diagnosing the code. Kill any leftover server processes and start a fresh
one on a new port before debugging any further. If you're not sure whether an
old server is still running on another port, check before assuming the code
is wrong again.

## Notes

- Requires a local server (not `file://`) because the game loads ES modules
  and fetches the marching cubes lookup tables.
- All assets are generated/synthesized at runtime — no build tools needed.
- https://github.com/Tsarpf/proced/blob/master/marching-cubes.js is where I found the marching cubes lookup tables.
