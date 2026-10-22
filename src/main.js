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
import { LEVELS } from './levels.js';
import { Save } from './save.js';
import { ITEMS } from './items.js';
import { IS_TOUCH } from './platform.js';
import { Formation } from './formation.js';
import { TEAM } from './skills/config.js';
import { TOON } from './toon.js';

const $ = (id) => document.getElementById(id);
const BOSS_ICON = { minotauro: '👹', kerberos: '🐕‍🦺', medusa: '🐍', basilisco: '🐉', kraken: '🐙', fenrir: '🐺', long: '🐲', cataclismo: '☄️' };
const stage = $('stage');
let quality = 'high';
try { quality = localStorage.getItem('gs_quality') || 'high'; } catch (e) { /* sin almacenamiento */ }
if (IS_TOUCH) quality = 'low';

/* ---------- renderer y composer ---------- */
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = !IS_TOUCH;
renderer.shadowMap.type = THREE.PCFSoftShadowMap; // sombras suaves
stage.appendChild(renderer.domElement);
let scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 1600);
camera.position.set(0, 40, 100);

let composer, bloomPass, gradePass, renderPass;
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uVig: { value: TOON.gradeVig }, uSat: { value: TOON.gradeSat }, uCon: { value: TOON.gradeCon } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uVig, uSat, uCon; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299,0.587,0.114)); c.rgb = mix(vec3(l), c.rgb, uSat);
      c.rgb = (c.rgb - 0.5) * uCon + 0.5;
      vec2 d = vUv - 0.5; float v = smoothstep(0.85, 0.25, length(d) * (1.0 + uVig)); c.rgb *= mix(1.0 - uVig, 1.0, v);
      gl_FragColor = c; }`,
};

function pixelRatio() {
  return quality === 'high' ? Math.min(window.devicePixelRatio || 1, 1.75) : IS_TOUCH ? Math.min(window.devicePixelRatio || 1, 1.25) : 1;
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
  bloomPass.threshold = world && world.look.bloom ? world.look.bloom : 0.92;
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
let currentLevel = LEVELS[0];
let envTex = null;
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Muestra la introducción cinemática del nivel mientras se construye su escenario 3D
async function loadLevel(level, minMs = 2600) {
  const t0 = performance.now();
  input.enabled = false;
  input.releaseLock();
  mode = 'loading';
  ui.hud(false);
  ui.showLevelIntro(level);
  ui.levelIntroProgress(0.12, 'Preparando el escenario 3D…');
  await nextFrame();
  if (!world || world.scenario !== level.scenario) {
    ui.levelIntroProgress(0.3, `Construyendo: ${level.place}…`);
    await nextFrame();
    await buildGame(level.scenario);
  }
  ui.levelIntroProgress(0.85, 'Colocando a las personas y animales…');
  await nextFrame();
  const el = performance.now() - t0;
  if (el < minMs) {
    ui.levelIntroProgress(0.95, '¡Todo listo!');
    await wait(minMs - el);
  }
  ui.levelIntroProgress(1, '');
}
function enterMissions() {
  mode = 'title';
  input.enabled = false;
  ui.hud(false);
  ui.showOverlay('inventory', false);
  if (showcase) scene.remove(showcase.root);
  scene.remove(pedestal);
  if (player && player.model) player.model.setVisible(false);
  game.clearVictims();
  game.state = 'idle';
  world.reset();
  ui.buildMissions(pickMission);
  ui.showScreen('missions');
}
async function pickMission(i) {
  audio.init();
  audio.click();
  currentLevel = LEVELS[i];
  if (!Save.isUnlocked(currentLevel.n)) return;
  await loadLevel(currentLevel, 2400);
  enterSelect();
}
async function startNextLevel() {
  const idx = LEVELS.findIndex((l) => l.id === currentLevel.id);
  if (idx < 0 || idx >= LEVELS.length - 1) return;
  currentLevel = LEVELS[idx + 1];
  if (!Save.isUnlocked(currentLevel.n)) return;
  ui.showOverlay('inventory', false);
  await loadLevel(currentLevel, 3200);
  ui.showScreen(null);
  mode = 'playing';
  game.start(curHero || HEROES[selected], currentLevel);
  input.requestLock();
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
  ui.markRecommended(currentLevel);
  const saved = Math.max(0, HEROES.findIndex((h) => h.id === (curHero ? curHero.id : Save.hero)));
  showHero(saved, true);
}
/* ---------- jefe de zona: selección de héroes y formación del equipo ---------- */
const formation = new Formation();
let teamIds = [];
let teamBusy = false;
function enterTeam() {
  mode = 'team';
  input.enabled = false;
  input.releaseLock();
  ui.hud(false);
  ui.clickHint(false);
  teamBusy = false;
  if (player && player.model) player.model.setVisible(false);
  const lv = currentLevel;
  ui.buildTeamScreen({ name: lv.bossName, icon: BOSS_ICON[lv.boss], sub: lv.bossTitle }, toggleTeamHero);
  formation.attach(scene, SHOW.x, SHOW.z);
  // equipo inicial: el héroe con el que exploraste + los últimos elegidos
  teamIds = [game.hero.id, ...Save.team.filter((id) => id !== game.hero.id)].slice(0, TEAM.size);
  ui.showScreen('team');
  ui.fade(false);
  refreshTeam();
}
function refreshTeam() {
  ui.renderTeamScreen(teamIds);
  formation.set(teamIds, fx);
}
function toggleTeamHero(id) {
  if (mode !== 'team' || teamBusy) return;
  const i = teamIds.indexOf(id);
  if (i >= 0) teamIds.splice(i, 1);
  else if (teamIds.length < TEAM.size) teamIds.push(id);
  else teamIds[TEAM.size - 1] = id; // equipo completo: sustituye al último
  audio.click();
  refreshTeam();
}
// Equipo recomendado: primero los héroes cuyo elemento es el ideal para el nivel, luego el resto
function recommendTeam() {
  if (mode !== 'team' || teamBusy) return;
  const best = HEROES.filter((h) => currentLevel.best.includes(h.element)).map((h) => h.id);
  const rest = HEROES.map((h) => h.id).filter((id) => !best.includes(id));
  teamIds = [...best, ...rest].slice(0, TEAM.size);
  audio.click();
  refreshTeam();
}
async function confirmTeam() {
  if (mode !== 'team' || teamBusy || !teamIds.length) return;
  teamBusy = true;
  audio.click();
  Save.setTeam(teamIds);
  ui.fade(true); // transición fluida: selección → formación → batalla
  await wait(550);
  formation.detach();
  ui.showScreen(null);
  mode = 'playing';
  game.startBoss(teamIds);
  input.requestLock();
}

function beginMission() {
  curHero = HEROES[selected];
  Save.setHero(curHero.id);
  scene.remove(pedestal);
  if (showcase) scene.remove(showcase.root);
  audio.init();
  goFullscreen();
  mode = 'playing';
  game.start(curHero, currentLevel);
  input.requestLock();
}
function goFullscreen() {
  if (!IS_TOUCH) return;
  try {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      el.requestFullscreen().then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {})).catch(() => {});
    }
  } catch (e) { /* no disponible (p. ej. iOS) */ }
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
    else if (mode === 'team') {
      formation.update(dt, camera);
      world.update(dt, clockT, camera.position, new THREE.Vector3(SHOW.x, terrainH(SHOW.x, SHOW.z), SHOW.z), 30, true);
      fx.update(dt, camera, renderer.domElement.height);
    } else if (mode === 'playing') {
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
    const hh = showcase.height || 1.8; // encuadre a la medida de cada héroe (el pequeño no se pierde, el grande cabe)
    camera.position.set(3.3 + sway * 0.6, y + 0.5 + hh * 0.45, SHOW.z + 3.2 + hh * 1.1);
    camera.lookAt(SHOW.x - 0.9, y + hh * 0.67, SHOW.z);
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

function disposeScene(sc) {
  sc.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const m = o.material;
    if (m) {
      for (const mm of Array.isArray(m) ? m : [m]) {
        for (const k in mm) {
          const v = mm[k];
          if (v && v.isTexture) v.dispose();
        }
        mm.dispose();
      }
    }
  });
}

async function buildGame(scenario) {
  if (game) game.clearVictims();
  for (const h of HEROES) {
    const m = getHeroModel(h.id);
    if (m.root.parent) m.root.parent.remove(m.root);
  }
  scene.remove(pedestal);
  showcase = null;
  if (world) disposeScene(scene);
  scene = new THREE.Scene();
  if (renderPass) renderPass.scene = scene;
  buildEnvironment();
  await nextFrame();
  world = createWorld(scene, renderer, { quality, scenario });
  SHOW.x = CFG.START.x;
  SHOW.z = CFG.START.z - 5.5;
  renderer.toneMappingExposure = world.look.exposure;
  if (bloomPass) bloomPass.threshold = world.look.bloom || 0.92;
  await nextFrame();
  fx = new FX(scene);
  player = new Player(world);
  chase = new ChaseCam(camera, world);
  game = new Game({ scene, camera, renderer, world, player, chase, fx, input });
  game.onBossPrep = enterTeam;
  window.__g = { game, world, player, chase, input, camera, scene, renderer, get mode() { return mode; }, setMode: (m) => (mode = m), enterSelect, beginMission, showHero, HEROES, fx, LEVELS, Save, ITEMS, pickMission, enterMissions, buildGame, loadLevel, startNextLevel, get level() { return currentLevel; } };
}

async function boot() {
  ui.init();
  ui.showScreen('loading');
  input = new Input(renderer.domElement);
  await nextFrame();
  resizeIfNeeded();
  ui.loadingMsg('Construyendo la ciudad en 3D…');
  await nextFrame();
  await buildGame('flood');
  ui.loadingMsg('Buscando modelos 3D realistas…');
  await preloadGLBHeroes();
  for (const h of HEROES) {
    ui.loadingMsg(`Creando a ${h.name}…`);
    await nextFrame();
    const m = getHeroModel(h.id);
    m.setVisible(false);
  }
  bindUi();
  ui.buildSelect((i) => showHero(i));
  enterTitle();
  requestAnimationFrame(frame);
}

// Mapa de entorno (reflejos realistas en armaduras, ojos y metales)
function buildEnvironment() {
  if (envTex) {
    scene.environment = envTex;
    scene.environmentIntensity = 0.75;
    return;
  }
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
  envTex = pm.fromScene(env, 0.02).texture;
  scene.environment = envTex;
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

// La música del juego (intro y todos los niveles) arranca con el primer gesto del usuario,
// porque el navegador no permite audio automático antes de una interacción.
function armMusic() {
  const events = ['pointerdown', 'keydown', 'touchend', 'click'];
  const go = () => {
    audio.startMusic(); // idempotente; reintenta reanudar el audio en cada gesto hasta que suene
    if (audio.musicPlaying) events.forEach((e) => window.removeEventListener(e, go, true));
  };
  events.forEach((e) => window.addEventListener(e, go, true));
}

function bindUi() {
  armMusic();
  setQuality(quality);
  $('btn-play').onclick = () => { audio.init(); audio.click(); goFullscreen(); enterMissions(); };
  $('btn-back-m').onclick = () => { audio.click(); enterTitle(); };
  $('btn-missions').onclick = () => enterMissions();
  $('btn-missions2').onclick = () => enterMissions();
  $('btn-next').onclick = () => startNextLevel();
  $('btn-inv-m').onclick = () => ui.showInventory(curHero || HEROES[selected]);
  $('btn-inv-end').onclick = () => ui.showInventory(curHero || HEROES[selected]);
  $('btn-inv-close').onclick = () => ui.showOverlay('inventory', false);
  $('btn-how').onclick = () => { audio.init(); audio.click(); ui.showOverlay('how', true); };
  $('btn-how-close').onclick = () => ui.showOverlay('how', false);
  $('btn-quality').onclick = () => setQuality(quality === 'high' ? 'low' : 'high');
  $('btn-quality2').onclick = () => setQuality(quality === 'high' ? 'low' : 'high');
  if (IS_TOUCH) { $('btn-quality').style.display = 'none'; $('btn-quality2').style.display = 'none'; }
  $('btn-sound').onclick = toggleSound;
  $('btn-sound2').onclick = toggleSound;
  $('btn-back').onclick = () => { audio.click(); enterMissions(); };
  $('btn-start').onclick = () => beginMission();
  $('btn-resume').onclick = resumeGame;
  $('btn-restart').onclick = () => { ui.showScreen(null); mode = 'playing'; game.start(curHero, currentLevel); input.requestLock(); };
  $('btn-change').onclick = () => enterSelect();
  $('btn-menu').onclick = () => enterTitle();
  $('btn-again').onclick = () => { ui.showScreen(null); mode = 'playing'; game.start(curHero, currentLevel); input.requestLock(); };
  $('btn-change2').onclick = () => enterSelect();
  $('btn-menu2').onclick = () => enterTitle();

  input.on('selectPrev', () => mode === 'select' && showHero(selected - 1));
  input.on('selectNext', () => mode === 'select' && showHero(selected + 1));
  input.on('confirm', () => mode === 'select' && beginMission());
  input.on('mute', toggleSound);
  input.on('power', () => mode === 'playing' && game.state === 'playing' && game.useAbility());
  input.on('ability', (i) => mode === 'playing' && game.selectAbility(i));
  input.on('abilityNext', () => mode === 'playing' && game.cycleAbility(1));
  input.on('teamPrev', () => mode === 'playing' && game.cycleTeam(-1));
  input.on('teamNext', () => mode === 'playing' && game.cycleTeam(1));
  $('btn-team-ok').onclick = confirmTeam;
  $('btn-team-rec').onclick = recommendTeam;
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
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
}

boot().catch((e) => {
  console.error(e);
  $('loading-msg').textContent = 'Error al cargar: ' + (e && e.message ? e.message : e);
});
