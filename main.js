import { ISO_LEVEL, TOOLS } from './constants.js';
import { Planet } from './planet.js';
import { Player } from './player.js';
import { Camera } from './camera.js';
import { Input } from './input.js';
import { Inventory } from './inventory.js';
import { Economy } from './economy.js';
import { Audio } from './audio.js';
import { Factory } from './factory/factory.js';
import { UI } from './ui/ui.js';
import { SaveManager, serializeGame, deserializeGame } from './save.js';
import { setupScene, placeSun } from './game/sceneSetup.js';
import { BuildingInteractions } from './game/interactions.js';
import { Minimap } from './ui/minimap.js';

async function loadMarchingCubes(onProgress) {
  onProgress('Loading marching cubes lookup tables...', 0.1);
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = './marching-cubes.js';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Failed to load marching-cubes.js'));
    document.head.appendChild(script);
  });
  onProgress('Marching cubes loaded.', 0.2);
  if (typeof edgeTable === 'undefined' || typeof triTable === 'undefined') {
    throw new Error('edgeTable / triTable not defined after loading marching-cubes.js');
  }
}

// worldMeta: { id, name, seed }, save: existing save blob or null
async function startGame(worldMeta, save, saveManager) {
  const seed = worldMeta.seed;
  document.getElementById('main-menu').style.display = 'none';
  document.getElementById('loading-screen').style.display = 'flex';
  const loadBar = document.getElementById('loading-bar-fill');
  const loadText = document.getElementById('loading-text');

  const setProgress = (msg, pct) => {
    loadText.textContent = msg;
    loadBar.style.width = (pct * 100) + '%';
  };

  try {
    await loadMarchingCubes(setProgress);
  } catch (e) {
    loadText.textContent = 'ERROR: ' + e.message;
    console.error(e);
    return;
  }

  setProgress('Setting up renderer...', 0.25);

  const {
    renderer, scene,
    ambientLight, sunLight, sunCoreMesh, lantern,
    SUN_ORBIT, SUN_PERIOD,
  } = setupScene();

  let sunAngle = Math.PI / 2; // overridden after restoring save (sunAngleInit), see below
  let undergroundState = false;
  let undergroundDebounce = 0;

  // Place the sun immediately (not just inside loop()) so it never starts at
  // the default (0,0,0) — i.e. the planet's center — for the first frame.
  placeSun(sunCoreMesh, sunAngle, SUN_ORBIT);

  setProgress(`Generating planet (seed: ${seed})...`, 0.3);

  // Scopes all window/document-level listeners for this play session so
  // quitting to the menu (and starting another world) doesn't leave stale
  // handlers attached to shared globals.
  const sessionAbort = new AbortController();
  const { signal } = sessionAbort;

  const economy = new Economy(seed);
  const inventory = new Inventory();
  const audio = new Audio();
  const inputHandler = new Input(signal);

  const planet = new Planet(scene, seed);
  const camera = new Camera(renderer, signal);
  const minimap = new Minimap(scene);

  // Restore terrain edits from save BEFORE generating chunks, so the planet
  // is built correctly the first time (no need to regenerate later).
  if (save && save.planet && save.planet.mineOverrides) {
    planet._mineOverrides = new Map(save.planet.mineOverrides);
  }
  if (save && save.planet && save.planet.shellTargetR) {
    planet._shellTargetR = new Map(save.planet.shellTargetR);
  }

  // Generate + mesh every initial chunk on the worker pool — runs entirely
  // off the main thread, so the loading bar animates smoothly and the page
  // never freezes during world generation.
  setProgress('Generating terrain...', 0.3);
  await planet.buildInitialChunksAsync((frac) => {
    setProgress(`Generating terrain... ${Math.floor(frac * 100)}%`, 0.3 + frac * 0.6);
  });

  setProgress('Spawning player...', 0.9);
  const player = new Player(scene, planet);

  // Force everything dark at spawn — sun, lantern, and ambient all start at 0
  // so the planet never appears lit up before the lighting loop settles.
  sunLight.intensity = 0;
  lantern.intensity = 0;
  planet.material.uniforms.sunIntensity.value = 0;
  planet.material.uniforms.lanternIntensity.value = 0;
  planet.material.uniforms.ambientIntensity.value = 0;

  const factory = new Factory(scene, planet, economy, inventory, audio);
  const ui = new UI(economy, inventory, factory, player, audio, signal);
  ui.showSeed(seed);

  // Restore player/inventory/economy/factory/sun/tool state from save
  let toolIndexInit = 0;
  let sunAngleInit = Math.PI / 2;
  if (save) {
    deserializeGame(save, {
      player, inventory, economy, factory,
      createBuilding: (type, pos, norm, yaw) => factory.placeBuildingFree(type, pos, norm, yaw),
      connectBelts: (from, to, tier) => factory.connectBelts(from, to, tier),
    });
    if (save.sunAngle !== undefined) sunAngleInit = save.sunAngle;
    if (save.toolIndex !== undefined) toolIndexInit = save.toolIndex;
  }

  // Re-place the sun at the restored angle (it was initially placed at the
  // default angle before the save was loaded).
  sunAngle = sunAngleInit;
  placeSun(sunCoreMesh, sunAngle, SUN_ORBIT);

  // Terrain tool hotbar selection (1-9/0 or scroll wheel)
  let toolIndex = toolIndexInit;
  ui.setSelectedTool(toolIndex);
  const DIGIT_KEYS = ['Digit1','Digit2','Digit3','Digit4','Digit5','Digit6','Digit7','Digit8','Digit9','Digit0'];

  // Building placement, moving, and belt-connection interactions
  const interactions = new BuildingInteractions(scene, planet, factory, ui, audio, economy, inventory, camera);

  setProgress('Ready!', 1.0);
  await new Promise(r => setTimeout(r, 300));

  // Show game
  document.getElementById('loading-screen').style.display = 'none';
  document.getElementById('ui-root').style.display = 'block';

  // Click on canvas to lock pointer
  renderer.domElement.addEventListener('click', () => {
    if (!inputHandler.pointerLocked) {
      inputHandler.requestPointerLock(renderer.domElement);
    }
  });

  // Right-click: place building or connect belt
  renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());

  // ---- Saving ----
  const saveIndicator = document.getElementById('save-indicator');
  let saveIndicatorTimer = 0;

  function doSave() {
    const data = serializeGame({ planet, player, inventory, economy, factory, sunAngle, toolIndex });
    saveManager.saveGame(worldMeta.id, data);
    saveIndicatorTimer = 2.0;
  }

  let autosaveTimer = 0;
  const AUTOSAVE_INTERVAL = 300; // 5 minutes

  window.addEventListener('beforeunload', () => {
    // Best-effort synchronous-ish save on tab close. IndexedDB writes here
    // may not always complete, but most browsers give it a brief window.
    doSave();
  }, { signal });

  // ---- Pause menu ----
  const pauseMenu = document.getElementById('pause-menu');
  let paused = false;

  function setPaused(val) {
    paused = val;
    pauseMenu.style.display = val ? 'flex' : 'none';
    if (val && inputHandler.pointerLocked) document.exitPointerLock();
  }

  document.getElementById('pause-resume-btn').addEventListener('click', () => setPaused(false));
  document.getElementById('pause-save-btn').addEventListener('click', () => doSave());
  document.getElementById('pause-menu-btn').addEventListener('click', () => {
    doSave();
    quitToMenu();
  });

  let stopped = false;

  // Tears down the running game and returns to the main menu without a full
  // page reload (avoids re-loading marching cubes + regenerating the planet
  // just to show the menu).
  function quitToMenu() {
    stopped = true;
    sessionAbort.abort();
    setPaused(false);
    if (inputHandler.pointerLocked) document.exitPointerLock();
    document.getElementById('ui-root').style.display = 'none';
    // Reset panel/toolbar visual state so the next session starts clean.
    for (const id of [...ui._openPanels]) ui.closePanel(id);
    renderer.domElement.remove();
    renderer.dispose();
    document.getElementById('main-menu').style.display = 'flex';
    initMenu().catch(e => {
      console.error('Failed to reload main menu:', e);
      document.getElementById('main-menu').innerHTML = `<h1>PLANET VOXEL</h1><div style="color:#f66">Failed to load: ${e.message}</div>`;
    });
  }

  window.addEventListener('keydown', e => {
    if (e.code === 'KeyP') {
      if (paused) setPaused(false);
      else setPaused(true);
    }
  }, { signal });

  let lastTime = performance.now();
  let startupFade = 0;

  function loop() {
    if (stopped) return;
    requestAnimationFrame(loop);
    const now = performance.now();
    let dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    if (paused) dt = 0; // freeze simulation while paused, but keep rendering

    autosaveTimer += dt;
    if (autosaveTimer >= AUTOSAVE_INTERVAL) {
      autosaveTimer = 0;
      doSave();
    }
    if (saveIndicatorTimer > 0) {
      saveIndicatorTimer -= 1/60;
      saveIndicator.style.opacity = Math.min(1, saveIndicatorTimer * 2).toString();
    } else {
      saveIndicator.style.opacity = '0';
    }

    // Day/night cycle — sun orbits in a plane tilted ~35° from equator
    sunAngle += (Math.PI * 2 / SUN_PERIOD) * dt;
    placeSun(sunCoreMesh, sunAngle, SUN_ORBIT);
    sunLight.position.copy(sunCoreMesh.position);
    // Lantern auto-dims when in full daylight (sun facing this side of the planet)
    const sunDir = sunCoreMesh.position.clone().normalize();
    const playerDir = player.position.clone().normalize();
    const dayDot = sunDir.dot(playerDir); // 1=facing sun, -1=facing away
    // Underground check: raycast straight up from the player — if solid terrain
    // (a ceiling) is hit anywhere along the way, the player is in a cave/tunnel.
    const up = player.up;
    const p = player.position;
    let rawUnderground = false;
    for (let d = 1; d <= 30; d += 1) {
      if (planet.density(p.x + up.x*d, p.y + up.y*d, p.z + up.z*d) > ISO_LEVEL) { rawUnderground = true; break; }
    }
    // Debounce: longer delay going surface->underground to prevent entrance sputtering
    if (rawUnderground !== undergroundState) {
      undergroundDebounce += dt;
      const threshold = rawUnderground ? 0.8 : 0.2;
      if (undergroundDebounce >= threshold) { undergroundState = rawUnderground; undergroundDebounce = 0; }
    } else {
      undergroundDebounce = 0;
    }
    sunLight.position.copy(sunCoreMesh.position);
    // Fade everything in from black over the first second of play, so the
    // planet never flashes fully-lit before lighting state has settled.
    startupFade = Math.min(1, startupFade + dt / 1.0);

    sunLight.intensity = (undergroundState ? 0.0 : 1.2) * startupFade;
    ambientLight.intensity = 0.03 * startupFade;
    // Lantern reacts to actual light level around the player: dark -> on, bright -> off.
    // Underground always counts as dark (0), regardless of which side of the planet.
    const lightLevel = undergroundState ? 0.0 : Math.max(0, dayDot);
    const lanternTarget = lightLevel < 0.3 ? 2.5 : 0.0;
    lantern.intensity += (lanternTarget - lantern.intensity) * Math.min(1, dt * 3);
    lantern.position.copy(player.position).addScaledVector(player.up, 1.2);
    // Drive planet shader uniforms — handles terrain lighting independently
    const u = planet.material.uniforms;
    u.sunPosition.value.copy(sunCoreMesh.position);
    // Per-vertex hemisphere gate in the shader already handles day/night and
    // sky-access correctly — no need to also gate this global uniform by the
    // player's own dayDot, which would dim the whole scene unless the player
    // stands exactly at the sub-solar point.
    u.sunIntensity.value = 1.2 * startupFade;
    u.lanternPosition.value.copy(lantern.position);
    u.lanternIntensity.value = lantern.intensity * startupFade;
    u.ambientIntensity.value = 0.03 * startupFade;

    // Economy update
    const econResult = economy.update(dt);
    if (econResult && econResult.spike) {
      ui.showDemandSpike(econResult.spike);
      audio.playAlert();
    }

    // Terrain tool hotbar — number keys select directly, scroll wheel cycles
    if (inputHandler.pointerLocked) {
      for (let i = 0; i < DIGIT_KEYS.length; i++) {
        if (i < TOOLS.length && inputHandler.consumeKey(DIGIT_KEYS[i])) toolIndex = i;
      }
      const scroll = inputHandler.consumeScroll();
      if (scroll !== 0) {
        toolIndex = (toolIndex + (scroll > 0 ? 1 : -1) + TOOLS.length) % TOOLS.length;
      }
      ui.setSelectedTool(toolIndex);
    }

    // Player update (skip if a panel is open and not locked)
    const md = inputHandler.consumeMouseDelta();
    if (inputHandler.pointerLocked) camera.rotate(md.x, md.y);
    if (inputHandler.pointerLocked) {
      player.update(dt, inputHandler, camera, inventory, audio, economy, TOOLS[toolIndex].id);
    }

    // Camera follows player
    camera.update(player.position, player.up);
    // Hide player mesh in first person
    player.mesh.visible = false;
    // Minimap follows the player too — rotates so forward = up on the map
    minimap.update(player.position, player.up, camera.getForwardDir());

    // Building placement, moving, belt connections, demolish/feed hints
    interactions.update(inputHandler);

    // Factory
    factory.update(dt);
    planet.meshChunksDirty();
    ui.update(dt);

    // Consume unused clicks to prevent stale state
    inputHandler.consumeClick();

    renderer.render(scene, camera.camera);

    // Minimap — rendered into a small viewport in the top-left corner via
    // scissor test, after the main scene so it draws on top. setViewport/
    // setScissor take CSS pixels (Three.js applies devicePixelRatio itself).
    const mmSize = Math.min(180, window.innerWidth, window.innerHeight);
    const mmMargin = 16;
    renderer.setScissorTest(true);
    renderer.setViewport(mmMargin, window.innerHeight - mmSize - mmMargin, mmSize, mmSize);
    renderer.setScissor(mmMargin, window.innerHeight - mmSize - mmMargin, mmSize, mmSize);
    renderer.render(scene, minimap.camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  }

  loop();
}

// ---- Main menu ----
async function initMenu() {
  const saveManager = new SaveManager();
  await saveManager.init();

  const worldListEl = document.getElementById('world-list');
  const emptyMsgEl = document.getElementById('menu-empty-msg');
  const nameInput = document.getElementById('new-world-name');
  const seedInput = document.getElementById('new-world-seed');
  // Clone+replace the button to strip any listeners from a previous
  // initMenu() call (quitting to menu re-runs this function).
  let createBtn = document.getElementById('new-world-btn');
  const freshCreateBtn = createBtn.cloneNode(true);
  createBtn.replaceWith(freshCreateBtn);
  createBtn = freshCreateBtn;

  async function refreshWorldList() {
    const worlds = await saveManager.listWorlds();
    worldListEl.innerHTML = '';
    emptyMsgEl.style.display = worlds.length === 0 ? 'block' : 'none';
    for (const meta of worlds) {
      const row = document.createElement('div');
      row.className = 'world-row';
      const date = new Date(meta.lastPlayed).toLocaleString();
      row.innerHTML = `
        <div class="world-row-info">
          <div class="world-row-name">${meta.name}</div>
          <div class="world-row-meta">Seed ${meta.seed} — Last played ${date}</div>
        </div>
        <div class="world-row-delete" title="Delete world">✕</div>
      `;
      row.querySelector('.world-row-info').addEventListener('click', async () => {
        const save = await saveManager.getSave(meta.id);
        launch(meta, save || null, saveManager);
      });
      row.querySelector('.world-row-delete').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`Delete world "${meta.name}"? This cannot be undone.`)) {
          await saveManager.deleteWorld(meta.id);
          refreshWorldList();
        }
      });
      worldListEl.appendChild(row);
    }
  }

  createBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim() || 'Unnamed Planet';
    let seed = parseInt(seedInput.value.trim());
    if (isNaN(seed)) seed = Math.floor(Math.random() * 1e9);
    const meta = await saveManager.createWorld(name, seed);
    launch(meta, null, saveManager);
  });

  await refreshWorldList();
}

function launch(worldMeta, save, saveManager) {
  startGame(worldMeta, save, saveManager).catch(e => {
    document.getElementById('loading-text').textContent = 'Fatal error: ' + e.message;
    console.error(e);
  });
}

initMenu().catch(e => {
  console.error('Failed to initialize main menu:', e);
  document.getElementById('main-menu').innerHTML = `<h1>PLANET VOXEL</h1><div style="color:#f66">Failed to load: ${e.message}</div>`;
});
