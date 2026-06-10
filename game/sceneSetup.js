import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';
import { PLANET_RADIUS } from '../constants.js';

// Builds the renderer, scene, star field, lighting rig (ambient/sun/lantern)
// and atmosphere glow. Returns everything the main loop needs to drive the
// day/night cycle and lighting uniforms each frame.
export function setupScene() {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = false;
  document.body.insertBefore(renderer.domElement, document.body.firstChild);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000008);
  scene.fog = new THREE.Fog(0x000008, 300, 600);

  // Stars
  const starGeo = new THREE.BufferGeometry();
  const starVerts = [];
  for (let i = 0; i < 6000; i++) {
    const r = 800 + Math.random() * 400;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    starVerts.push(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.sin(phi) * Math.sin(theta),
      r * Math.cos(phi)
    );
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starVerts, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.8, depthWrite: false })));

  // Near-zero ambient — dark side is total darkness, only player lantern provides local light
  const ambientLight = new THREE.AmbientLight(0x111133, 0.03);
  scene.add(ambientLight);

  const sunLight = new THREE.PointLight(0xfff5e0, 2.0, 0, 0);
  sunLight.castShadow = false;
  scene.add(sunLight);

  const SUN_RADIUS = 28;
  const SUN_ORBIT  = PLANET_RADIUS * 3.8;
  const sunCoreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  const sunCoreMesh = new THREE.Mesh(new THREE.SphereGeometry(SUN_RADIUS, 20, 20), sunCoreMat);
  sunCoreMesh.frustumCulled = false;
  sunCoreMesh.renderOrder = 1;
  sunCoreMesh.receiveShadow = false;
  sunCoreMesh.castShadow = false;
  const coronaMat = new THREE.MeshBasicMaterial({
    color: 0xaaccff, transparent: true, opacity: 0.12,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const c1 = new THREE.Mesh(new THREE.SphereGeometry(SUN_RADIUS * 1.6, 20, 20), coronaMat);
  c1.frustumCulled = false; c1.renderOrder = 0;
  sunCoreMesh.add(c1);
  const coronaMat2 = new THREE.MeshBasicMaterial({
    color: 0x8899ff, transparent: true, opacity: 0.06,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const c2 = new THREE.Mesh(new THREE.SphereGeometry(SUN_RADIUS * 2.6, 20, 20), coronaMat2);
  c2.frustumCulled = false; c2.renderOrder = 0;
  sunCoreMesh.add(c2);
  scene.add(sunCoreMesh);

  const SUN_PERIOD = 180;

  const lantern = new THREE.PointLight(0xffcc77, 2.5, 18);
  lantern.decay = 1;
  lantern.castShadow = false;
  scene.add(lantern);
  // Seed the lantern at the player's spawn point (not (0,0,0) / planet center)
  // so the first frame's shader uniforms are correct before loop() runs.
  lantern.position.set(0, PLANET_RADIUS + 4 + 1.2, 0);

  // Atmospheric glow — FrontSide so it only renders when viewed from OUTSIDE the sphere.
  // The player is always inside (surface ~180, sphere ~210) so it never washes over the sun.
  const atmosMesh = new THREE.Mesh(
    new THREE.SphereGeometry(210, 32, 32),
    new THREE.MeshBasicMaterial({
      color: 0x3366ff, transparent: true, opacity: 0.08,
      side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  scene.add(atmosMesh);

  return {
    renderer, scene,
    ambientLight, sunLight, sunCoreMesh, lantern, atmosMesh,
    SUN_ORBIT, SUN_PERIOD,
  };
}

// Places the sun at `sunAngle` along its tilted orbit. Called once at startup
// (before the save's sunAngle is known), once after restoring the save, and
// every frame from the main loop.
export function placeSun(sunCoreMesh, sunAngle, SUN_ORBIT) {
  const tilt = Math.PI / 5.2;
  sunCoreMesh.position.set(
    Math.cos(sunAngle) * SUN_ORBIT,
    Math.sin(sunAngle) * Math.sin(tilt) * SUN_ORBIT,
    Math.sin(sunAngle) * Math.cos(tilt) * SUN_ORBIT
  );
}
