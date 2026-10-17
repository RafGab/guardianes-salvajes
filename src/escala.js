import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { HEROES, getHeroModel, preloadGLBHeroes } from './heroes.js';
import { makeBossModel } from './bosses.js';
import { loadGLB, measure } from './glb.js';
import { HERO_SCALE, BOSS_SCALE, BOSS_KEY, MANNEQUIN_H, bossScale, modelUrl } from './scale.js';

// Zona de prueba de la ESCALA MAESTRA: maniquí de 1,80 m, los 7 héroes, los 7 jefes y una cuadrícula métrica.
// Usa exactamente el mismo código de modelos que el juego (scale.js, heroes.js, bosses.js).

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101a2a);
scene.fog = new THREE.Fog(0x101a2a, 60, 140);
const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 400);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x3a3a44, 1.5));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(14, 30, 18);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 30, bottom: -30, near: 1, far: 100 });
scene.add(sun);

// ---- suelo y cuadrícula: 1 m fino, 5 m grueso ----
const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 90), new THREE.MeshStandardMaterial({ color: 0x1b2638, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const g1 = new THREE.GridHelper(160, 160, 0x3a5070, 0x24344c);
g1.position.y = 0.002;
scene.add(g1);
const g5 = new THREE.GridHelper(160, 32, 0x7a9ac8, 0x7a9ac8);
g5.position.y = 0.004;
g5.material.opacity = 0.55;
g5.material.transparent = true;
scene.add(g5);

function label(text, size = 0.5, color = '#ffffff', bg = null) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const x = c.getContext('2d');
  if (bg) { x.fillStyle = bg; x.fillRect(0, 0, 512, 128); }
  x.fillStyle = color;
  let fs = 54;
  x.font = `bold ${fs}px system-ui, sans-serif`;
  while (x.measureText(text).width > 490 && fs > 20) { fs -= 2; x.font = `bold ${fs}px system-ui, sans-serif`; }
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(text, 256, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
  sp.scale.set(size * 4, size, 1);
  sp.renderOrder = 10;
  return sp;
}
const fmt = (v) => v.toFixed(2).replace('.', ',');

// ---- maniquí de referencia (1,80 m) ----
function mannequin() {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0xb8c4d6, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 1.0, 6, 12), m);
  body.position.y = 0.95;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), m);
  head.position.y = MANNEQUIN_H - 0.13;
  body.castShadow = head.castShadow = true;
  g.add(body, head);
  return g;
}

// ---- regla vertical: `max` metros, una marca cada `step` m ----
function ruler(x, z, max = 6, step = 1) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffd36a });
  const pole = new THREE.Mesh(new THREE.BoxGeometry(0.05, max, 0.05), mat);
  pole.position.y = max / 2;
  g.add(pole);
  for (let v = 0; v <= max + 1e-6; v += step) {
    const tick = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 0.03), mat);
    tick.position.set(0.2, v, 0);
    g.add(tick);
    if (v > 0) { const l = label(`${fmt(v)} m`.replace(',00', ''), step < 1 ? 0.2 : 0.34, '#ffd36a'); l.position.set(0.85, v, 0); g.add(l); }
  }
  g.position.set(x, 0, z);
  return g;
}

const rows = [];
const heroGroup = new THREE.Group();
const bossGroup = new THREE.Group();
scene.add(heroGroup, bossGroup);
const animated = [];

function place(group, obj, x, z, text, labelSize = 0.42) {
  obj.position.set(x, 0, z);
  group.add(obj);
  const l = label(text, labelSize, '#ffffff', 'rgba(8,14,26,.7)');
  const m = measure(obj);
  l.position.set(x, m.h + 0.55, z);
  group.add(l);
  return m;
}

async function build() {
  // modelos reales de los jefes y de los héroes
  await Promise.all([
    preloadGLBHeroes(),
    ...Object.values(BOSS_SCALE).filter((s) => s.glb).map((s) => loadGLB(modelUrl(s.glb)).catch(() => {})),
  ]);

  // Héroes de menor a mayor altura, uno junto al otro, con el maniquí a la izquierda
  const heroIds = Object.keys(HERO_SCALE).sort((a, b) => HERO_SCALE[a].height - HERO_SCALE[b].height);
  const mq = mannequin();
  mq.position.set(-3.0, 0, 0);
  heroGroup.add(mq);
  const mql = label(`Maniquí ${fmt(MANNEQUIN_H)} m`, 0.4, '#9fe0ff', 'rgba(8,14,26,.7)');
  mql.position.set(-3.0, MANNEQUIN_H + 0.5, 0);
  heroGroup.add(mql);
  heroGroup.add(ruler(-5, 0, 2, 0.25));
  let x = 0;
  for (const id of heroIds) {
    const S = HERO_SCALE[id];
    const model = getHeroModel(id);
    animated.push(model);
    const m = place(heroGroup, model.root, x, 0, `${S.nombre} ${fmt(S.height)} m`);
    rows.push({ id, S, kind: 'héroe', fuente: model.dims.source, scale: model.dims.scale, m: measure(model.root) });
    x += 2.0;
  }
  heroGroup.userData.maxX = x - 2.0;

  // Jefes de menor a mayor altura; separación según su anchura/longitud
  bossGroup.position.z = -14;
  const bossKinds = ['medusa', 'kerberos', 'basilisco', 'minotauro', 'fenrir', 'long', 'kraken'];
  bossKinds.sort((a, b) => bossScale(a).height - bossScale(b).height);
  const mq2 = mannequin();
  mq2.position.set(-3, 0, 0);
  bossGroup.add(mq2);
  const mql2 = label(`Maniquí ${fmt(MANNEQUIN_H)} m`, 0.4, '#9fe0ff', 'rgba(8,14,26,.7)');
  mql2.position.set(-3, MANNEQUIN_H + 0.5, 0);
  bossGroup.add(mql2);
  bossGroup.add(ruler(-5.2, 0, 6, 1));
  let bx = 1.5, prevHalf = 0;
  const bosses = [];
  for (const kind of bossKinds) {
    const S = bossScale(kind);
    const model = makeBossModel(kind);
    model.root.scale.setScalar(model.unit);
    const mm = measure(model.root);
    const half = Math.max(mm.w, mm.l) / 2;
    bx += prevHalf + half + 0.8;
    place(bossGroup, model.root, bx, 0, `${S.nombre} ${fmt(S.height)} m`, 0.9);
    rows.push({ id: kind, S, kind: 'jefe', fuente: model.source, scale: model.unit / model.naturalH, m: measure(model.root) });
    bosses.push({ kind, x: bx, model });
    prevHalf = half;
  }
  bossGroup.userData.maxX = bx + prevHalf;
  bossGroup.userData.bosses = bosses;
}

// ---- cámaras de prueba: se ajustan solas al ancho de cada fila ----
const views = {};
function fit(minX, maxX, z, camH, targetY, margin = 1.12) {
  const cx = (minX + maxX) / 2;
  const hw = ((maxX - minX) / 2) * margin;
  const hfov = 2 * Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect);
  const d = hw / Math.tan(hfov / 2);
  return { pos: [cx, camH, z + d], target: [cx, targetY, z] };
}
const showOnly = { heroes: [1, 0], jefes: [0, 1], todos: [1, 1], peque: [1, 1], grande: [1, 1] };
function setView(name) {
  const f = views[name];
  if (!f) return;
  const [h, b] = showOnly[name];
  heroGroup.visible = !!h;
  bossGroup.visible = !!b;
  scene.userData.copias.forEach((o) => { o.visible = name === 'peque' || name === 'grande'; });
  const v = f();
  camera.position.set(...v.pos);
  controls.target.set(...v.target);
  controls.update();
}
function defineViews() {
  const heroMax = heroGroup.userData.maxX, bossMax = bossGroup.userData.maxX;
  views.heroes = () => fit(-5.5, heroMax + 1, 0, 1.4, 0.75, 1.05);
  views.jefes = () => fit(-6, bossMax + 1, -14, 4.5, 2.6);
  views.todos = () => {
    const w = fit(-6, Math.max(heroMax, bossMax) + 1, -7, 22, 1.2, 1.0);
    return { pos: [w.pos[0], 21, w.pos[2] + 12], target: [w.target[0], 1.0, -7] };
  };
  const b = bossGroup.userData.bosses;
  const kr = b.find((o) => o.kind === 'kraken');
  const me = b.find((o) => o.kind === 'medusa');
  // Feneco (el más pequeño) junto al Kraken (el mayor)
  views.peque = () => fit(kr.x - 8, kr.x + 3, -14 + 2, 2.8, 2.4, 1.0);
  views.grande = () => fit(me.x - 4.2, me.x + 2.2, -14 + 2, 2.0, 1.3, 1.0);
}

// Para las dos comparaciones extremas, se colocan los personajes uno junto al otro en la zona de jefes
function placeSideBySide() {
  const b = bossGroup.userData.bosses;
  const kr = b.find((o) => o.kind === 'kraken');
  const me = b.find((o) => o.kind === 'medusa');
  const feneco = getHeroModel('halley');
  const jaglion = getHeroModel('jago');
  const f2 = feneco.root.clone(true);
  f2.position.set(kr.x - 4.2, 0, -14 + 1.6);
  scene.add(f2);
  const j2 = jaglion.root.clone(true);
  j2.position.set(me.x - 1.8, 0, -14 + 1.2);
  scene.add(j2);
  const lf = label('Feneco 0,75 m (copia)', 0.36, '#ffd36a', 'rgba(8,14,26,.7)');
  lf.position.set(kr.x - 4.2, 1.4, -14 + 1.6);
  scene.add(lf);
  const lj = label('Jaglion 1,55 m (copia)', 0.36, '#ffd36a', 'rgba(8,14,26,.7)');
  lj.position.set(me.x - 1.8, 2.3, -14 + 1.2);
  scene.add(lj);
  scene.userData.copias = [f2, j2, lf, lj];
}

function tabla() {
  const el = document.getElementById('info');
  const head = ['PERSONAJE', 'TIPO', 'ALTURA (m)', 'LONGITUD (m)', 'ANCHURA (m)', 'ESCALA APLICADA', 'RADIO COLISIÓN (m)', 'MODELO', 'OBSERVACIONES'];
  const body = rows.map((r) => `<tr><td>${r.S.nombre}</td><td>${r.S.tipo}</td><td>${fmt(r.m.h)}</td><td>${fmt(r.m.l)}</td><td>${fmt(r.m.w)}</td><td>×${fmt(r.scale)}</td><td>${fmt(r.S.radius)}</td><td>${r.fuente}</td><td>${r.S.notas || ''}</td></tr>`).join('');
  el.innerHTML = `<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
  el.style.display = el.style.display === 'block' ? 'none' : 'block';
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

build().then(() => {
  placeSideBySide();
  defineViews();
  setView('todos');
  document.getElementById('cargando').style.display = 'none';
  window.__lab = { rows, setView, camera, controls, scene, tabla };
});

document.querySelectorAll('#bar button[data-v]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.v)));
document.getElementById('tabla').addEventListener('click', tabla);
addEventListener('keydown', (e) => {
  const map = { 1: 'heroes', 2: 'jefes', 3: 'todos', 4: 'peque', 5: 'grande' };
  if (map[e.key]) setView(map[e.key]);
});

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  for (const m of animated) m.update(dt, { speed: 0, grounded: true });
  controls.update();
  renderer.render(scene, camera);
});
