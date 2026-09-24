import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { HEROES, ELEMENTS, getHeroModel, preloadGLBHeroes } from './heroes.js';
import { createWorld } from './world.js';
import { CFG, terrainH } from './city.js';
import { Player, ChaseCam } from './player.js';
import { Input } from './input.js';
import { FX } from './fx.js';
import { Game } from './game.js';
import { ui } from './ui.js';
import { Audio3D as audio } from './audio.js';
import { clamp, damp } from './utils.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
let quality = 'high';
try { quality = localStorage.getItem('gs_quality') || 'high'; } catch (e) { /* sin almacenamiento */ }

/* ---------- renderer y composer ---------- */
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
stage.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 1600);
camera.position.set(0, 40, 100);

let composer, bloomPass, gradePass, renderPass;
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uVig: { value: 0.38 }, uSat: { value: 1.08 }, uCon: { value: 1.06 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uVig, uSat, uCon; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299,0.587,0.114)); c.rgb = mix(vec3(l), c.rgb, uSat);
      c.rgb = (c.rgb - 0.5) * uCon + 0.5;
      vec2 d = vUv - 0.5; float v = smoothstep(0.85, 0.25, length(d) * (1.0 + uVig)); c.rgb *= mix(1.0 - uVig, 1.0, v);
      gl_FragColor = c; }`,
};

function pixelRatio() {
  return quality === 'high' ? Math.min(window.devicePixelRatio || 1, 1.75) : 1;
}
const URLQ = new URLSearchParams(location.search);
function buildComposer(w, h) {
  const pr = pixelRatio();
  const msaa = quality === 'high' && URLQ.get('msaa') === '1';
  const rt = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: msaa ? 4 : 0 });
  composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(pr);
  composer.setSize(w, h);
  renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.55, 0.7, 0.92);
  bloomPass.enabled = quality === 'high' && URLQ.get('bloom') !== '0';
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  gradePass = new ShaderPass(GradeShader);
  composer.addPass(gradePass);
  if (quality === 'high' && !msaa) composer.addPass(new SMAAPass(w * pr, h * pr));
}

let curW = 0, curH = 0;
function resizeIfNeeded() {
  const w = stage.clientWidth || window.innerWidth;
  const h = stage.clientHeight || window.innerHeight;
  if (w < 2 || h < 2) return false;
  if (w === curW && h === curH) return true;
  curW = w;
  curH = h;
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (composer) {
    composer.dispose?.();
  }
  buildComposer(w, h);
  return true;
}

/* ---------- estado ---------- */
let world, player, chase, fx, game, input;
let mode = 'boot';
let selected = 0;
let curHero = null;
let titleAngle = 0.6;
let clockT = 0;
let showcase = null;

/* ---------- pedestal para el showcase de héroes ---------- */
const SHOW = { x: 0, z: 56.5 };
const pedestal = new THREE.Group();
let pedRing, pedLight;
(function buildPedestal() {
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.6, 0.8, 32), new THREE.MeshStandardMaterial({ color: 0x1a2230, metalness: 0.7, roughness: 0.35 }));
  base.position.y = 0.4;
  base.castShadow = true;
  base.receiveShadow = true;
  pedestal.add(base);
  pedRing = new THREE.Mesh(new THREE.TorusGeometry(1.42, 0.05, 8, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff7a2a).multiplyScalar(2.4) }));
  pedRing.rotation.x = Math.PI / 2;
  pedRing.position.y = 0.8;
  pedestal.add(pedRing);
  pedLight = new THREE.PointLight(0xff7a2a, 1.6, 9, 1.5);
  pedLight.position.set(0, 1.2, 1.2);
  pedestal.add(pedLight);
})();

function showHero(i, burst = true) {
  selected = (i + HEROES.length) % HEROES.length;
  const def = HEROES[selected];
  if (showcase) scene.remove(showcase.root);
  showcase = getHeroModel(def.id);
  scene.add(showcase.root);
  showcase.setVisible(true);
  const y = terrainH(SHOW.x, SHOW.z) + 0.8;
  showcase.root.position.set(SHOW.x, y, SHOW.z);
  showcase.root.rotation.y = 0.35;
  const col = ELEMENTS[def.element].color;
  pedRing.material.color.set(col).multiplyScalar(2.4);
  pedLight.color.set(col);
  ui.fillSelect(selected);
  if (burst && fx) {
    for (let k = 0; k < 40; k++) {
      fx.sparkle(SHOW.x, y + 0.2, SHOW.z, col, 3.2);
    }
    if (def.element === 'fuego') fx.flameRing(SHOW.x, y, SHOW.z, 30);
    if (def.element === 'agua') fx.waterRing(SHOW.x, y, SHOW.z, 30);
    if (def.element === 'hielo') for (let k = 0; k < 40; k++) fx.iceShard(SHOW.x, y + 0.5, SHOW.z, 1.3);
    if (def.element === 'aire') for (let k = 0; k < 24; k++) fx.mist(SHOW.x + (Math.random() - 0.5), y + 0.3, SHOW.z + (Math.random() - 0.5), 0xeaf6ff, 1.6);
    if (def.element === 'tierra') for (let k = 0; k < 24; k++) { fx.rock(SHOW.x, y, SHOW.z); fx.gem(SHOW.x, y + 0.3, SHOW.z); }
    audio.click();
  }
}

/* ---------- modos ---------- */
function enterTitle() {
  mode = 'title';
  input.enabled = false;
  if (showcase) scene.remove(showcase.root);
  scene.remove(pedestal);
  if (player && player.model) player.model.setVisible(false);
  game.clearVictims();
  game.state = 'idle';
  ui.hud(false);
  ui.clearEdges();
  ui.showScreen('title');
  ui.clickHint(false);
  world.reset();
}
function enterSelect() {
  mode = 'select';
  input.enabled = false;
  ui.hud(false);
  if (player && player.model) player.model.setVisible(false);
  game.clearVictims();
  game.state = 'idle';
  world.reset();
  scene.add(pedestal);
  pedestal.position.set(SHOW.x, terrainH(SHOW.x, SHOW.z), SHOW.z);
  ui.showScreen('select');
  showHero(curHero ? HEROES.findIndex((h) => h.id === curHero.id) : 0, true);
}
function beginMission() {
  curHero = HEROES[selected];
  scene.remove(pedestal);
  if (showcase) scene.remove(showcase.root);
  audio.init();
  mode = 'playing';
  game.start(curHero);
  input.requestLock();
}
function pauseGame() {
  if (mode !== 'playing' || game.state === 'ending' || game.state === 'done') return;
  mode = 'paused';
  input.releaseLock();
  ui.showScreen('pause');
  ui.clickHint(false);
}
function resumeGame() {
  if (mode !== 'paused') return;
  mode = 'playing';
  ui.showScreen(null);
  input.requestLock();
}

/* ---------- bucle principal ---------- */
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  clockT += dt;
  if (!resizeIfNeeded() || !world) return;
  input.poll();
  try {
    if (mode === 'title' || mode === 'select') updateMenu(dt);
    else if (mode === 'playing') {
      game.update(dt);
      ui.clickHint(!input.locked && input.canLock && game.state === 'playing' && clockT - lastMouseT > 4 && !hintDismissed);
      if (game.state === 'done') mode = 'end';
    } else if (mode === 'paused') {
      world.update(0, clockT, camera.position, player.pos, game.t, false);
    } else if (mode === 'end') {
      world.update(dt * 0.4, clockT, camera.position, player.pos, game.t, false);
      fx.update(dt, camera, renderer.domElement.height);
    }
  } catch (e) {
    console.error(e);
    if (!frame.errShown) {
      frame.errShown = true;
      ui.banner('find', '⚠️ Error', String(e.message || e));
    }
  }
  composer.render();
}
let lastMouseT = 0;
let hintDismissed = false;

function updateMenu(dt) {
  const menuT = 20 + 26 * (0.5 - 0.5 * Math.cos(clockT * 0.06));
  if (mode === 'title') {
    titleAngle += dt * 0.045;
    const r = 108;
    camera.position.set(Math.cos(titleAngle) * r * 0.9, 34 + Math.sin(clockT * 0.2) * 3, Math.sin(titleAngle) * r * 0.75 + 4);
    camera.lookAt(0, 5, -8);
    world.update(dt, clockT, camera.position, new THREE.Vector3(0, 0, 0), menuT, true);
  } else {
    // showcase del héroe: cámara frontal con la ciudad de fondo
    const y = terrainH(SHOW.x, SHOW.z) + 0.8;
    const sway = Math.sin(clockT * 0.4) * 0.35;
    camera.position.set(3.3 + sway * 0.6, y + 1.35, SHOW.z + 5.3);
    camera.lookAt(SHOW.x - 0.9, y + 1.25, SHOW.z);
    if (!dragSel.active) showcase.root.rotation.y += dt * 0.35;
    showcase.update(dt, { speed: 0, grounded: true });
    const def = HEROES[selected];
    if (def.element === 'fuego' && Math.random() < dt * 30) fx.ember(SHOW.x, y, SHOW.z, 1);
    if (def.element === 'hielo' && Math.random() < dt * 20) fx.snow(SHOW.x, y, SHOW.z);
    if (def.element === 'agua' && Math.random() < dt * 14) fx.spray(SHOW.x + (Math.random() - 0.5) * 1.2, y + 1.6, SHOW.z + (Math.random() - 0.5), 0, 0.3, 0, 0.8);
    if (def.element === 'tierra' && Math.random() < dt * 9) fx.gem(SHOW.x, y + 0.2, SHOW.z);
    if (def.element === 'aire' && Math.random() < dt * 14) fx.sparkle(SHOW.x + (Math.random() - 0.5) * 1.6, y + 0.4 + Math.random() * 1.8, SHOW.z + (Math.random() - 0.5) * 1.6, 0xdff2ff, 0.4);
    world.update(dt, clockT, camera.position, new THREE.Vector3(SHOW.x, y, SHOW.z), menuT, true);
  }
  fx.update(dt, camera, renderer.domElement.height);
}

const dragSel = { active: false, x: 0 };

/* ---------- arranque ---------- */
const nextFrame = () => new Promise((r) => setTimeout(r, 16));

async function boot() {
  ui.init();
  ui.showScreen('loading');
  await nextFrame();
  resizeIfNeeded();
  ui.loadingMsg('Construyendo la ciudad en 3D…');
  await nextFrame();
  world = createWorld(scene, renderer, { quality });
  ui.loadingMsg('Creando a los héroes…');
  await nextFrame();
  fx = new FX(scene);
  input = new Input(renderer.domElement);
  player = new Player(world);
  chase = new ChaseCam(camera, world);
  buildEnvironment();
  ui.loadingMsg('Buscando modelos 3D realistas…');
  await preloadGLBHeroes();
  for (const h of HEROES) {
    ui.loadingMsg(`Creando a ${h.name}…`);
    await nextFrame();
    const m = getHeroModel(h.id);
    m.setVisible(false);
  }
  game = new Game({ scene, camera, renderer, world, player, chase, fx, input });
  bindUi();
  ui.buildSelect((i) => showHero(i));
  window.__g = { game, world, player, chase, input, camera, scene, renderer, get mode() { return mode; }, setMode: (m) => (mode = m), enterSelect, beginMission, showHero, HEROES, fx };
  enterTitle();
  requestAnimationFrame(frame);
}

// Mapa de entorno (reflejos realistas en armaduras, ojos y metales)
function buildEnvironment() {
  const env = new THREE.Scene();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(50, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: 'varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: 'varying vec3 vP; void main(){ float h=normalize(vP).y; vec3 top=vec3(0.30,0.36,0.46); vec3 hor=vec3(0.55,0.60,0.66); vec3 gr=vec3(0.10,0.11,0.12); vec3 c = h>0.0 ? mix(hor,top,pow(h,0.6)) : mix(hor,gr,clamp(-h*3.0,0.0,1.0)); gl_FragColor=vec4(c,1.); }',
    }),
  );
  env.add(sky);
  const light = (w, h, x, y, z, k) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.96, 0.9).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  light(18, 10, 20, 26, 14, 9);
  light(10, 10, -26, 12, -10, 4);
  light(24, 6, 0, 8, -34, 3);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(env, 0.02).texture;
  scene.environmentIntensity = 0.75;
  pm.dispose();
}

function setQuality(q) {
  quality = q;
  try { localStorage.setItem('gs_quality', q); } catch (e) { /* ok */ }
  const ss = q === 'high' ? 2048 : 1024;
  world.sun.shadow.mapSize.set(ss, ss);
  if (world.sun.shadow.map) {
    world.sun.shadow.map.dispose();
    world.sun.shadow.map = null;
  }
  curW = 0;
  const label = `⚙ Calidad: ${q === 'high' ? 'Alta' : 'Media'}`;
  $('btn-quality').textContent = label;
  $('btn-quality2').textContent = label;
}
function toggleSound() {
  audio.setMuted(!audio.muted);
  const label = `🔊 Sonido: ${audio.muted ? 'No' : 'Sí'}`;
  $('btn-sound').textContent = label;
  $('btn-sound2').textContent = label;
}

function bindUi() {
  setQuality(quality);
  $('btn-play').onclick = () => { audio.init(); audio.click(); enterSelect(); };
  $('btn-how').onclick = () => { audio.init(); audio.click(); ui.showOverlay('how', true); };
  $('btn-how-close').onclick = () => ui.showOverlay('how', false);
  $('btn-quality').onclick = () => setQuality(quality === 'high' ? 'low' : 'high');
  $('btn-quality2').onclick = () => setQuality(quality === 'high' ? 'low' : 'high');
  $('btn-sound').onclick = toggleSound;
  $('btn-sound2').onclick = toggleSound;
  $('btn-back').onclick = () => { audio.click(); enterTitle(); };
  $('btn-start').onclick = () => beginMission();
  $('btn-resume').onclick = resumeGame;
  $('btn-restart').onclick = () => { ui.showScreen(null); mode = 'playing'; game.start(curHero); input.requestLock(); };
  $('btn-change').onclick = () => enterSelect();
  $('btn-menu').onclick = () => enterTitle();
  $('btn-again').onclick = () => { ui.showScreen(null); mode = 'playing'; game.start(curHero); input.requestLock(); };
  $('btn-change2').onclick = () => enterSelect();
  $('btn-menu2').onclick = () => enterTitle();

  input.on('selectPrev', () => mode === 'select' && showHero(selected - 1));
  input.on('selectNext', () => mode === 'select' && showHero(selected + 1));
  input.on('confirm', () => mode === 'select' && beginMission());
  input.on('mute', toggleSound);
  input.on('power', () => mode === 'playing' && game.state === 'playing' && game.player.usePower(fx));
  input.on('rescue', () => mode === 'playing' && game.tryRescue());
  input.on('interact', () => mode === 'playing' && game.interact());
  input.on('recenter', () => mode === 'playing' && (chase.yaw = player.facing + Math.PI));
  input.on('respawn', () => {
    if (mode !== 'playing' || game.state !== 'playing') return;
    player.pos.set(CFG.START.x, terrainH(CFG.START.x, CFG.START.z) + 0.2, CFG.START.z);
    player.vy = 0;
    ui.banner('find', '↩️', 'De vuelta al punto de inicio');
  });
  input.on('pause', pauseGame);
  input.on('unlocked', pauseGame);
  input.on('lockchange', (l) => { if (l) hintDismissed = true; });
  window.addEventListener('mousemove', () => (lastMouseT = clockT));
  // arrastrar para girar al héroe en la selección
  const cvs = renderer.domElement;
  cvs.addEventListener('pointerdown', (e) => { if (mode === 'select') { dragSel.active = true; dragSel.x = e.clientX; } });
  window.addEventListener('pointerup', () => (dragSel.active = false));
  window.addEventListener('pointermove', (e) => {
    if (mode === 'select' && dragSel.active && showcase) {
      showcase.root.rotation.y += (e.clientX - dragSel.x) * 0.012;
      dragSel.x = e.clientX;
    }
  });
  window.addEventListener('resize', () => (curW = 0));
}

boot().catch((e) => {
  console.error(e);
  $('loading-msg').textContent = 'Error al cargar: ' + (e && e.message ? e.message : e);
});
