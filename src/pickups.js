import * as THREE from 'three';
import { terrainH, CFG } from './terrain.js';
import { makeRng } from './utils.js';
import { HEAL_ITEMS, PICKUP_SPAWN } from './skills/config.js';
import { Save } from './save.js';

// OBJETOS DE RECUPERACIÓN EN EL MAPA: bebidas energéticas y botiquines (normales y especiales por porcentaje).
// Se recogen por proximidad y se guardan en la mochila. Si ese almacenamiento está lleno, el objeto se queda en el suelo.

const TAU = Math.PI * 2;
const hashStr = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

function clearAt(world, x, y, z) {
  const near = world.solidsNear(x - 0.8, x + 0.8, z - 0.8, z + 0.8, []);
  for (const s of near) {
    if (s.x0 < x + 0.6 && s.x1 > x - 0.6 && s.z0 < z + 0.6 && s.z1 > z - 0.6 && s.y0 < y + 1.6 && s.y1 > y + 0.16) return false;
  }
  return true;
}

// Geometrías y materiales compartidos
const G = {};
function shared() {
  if (G.ready) return G;
  G.ready = true;
  G.can = new THREE.CylinderGeometry(0.2, 0.2, 0.62, 16);
  G.canTop = new THREE.CylinderGeometry(0.17, 0.2, 0.05, 16);
  G.box = new THREE.BoxGeometry(0.72, 0.5, 0.36);
  G.barH = new THREE.BoxGeometry(0.4, 0.12, 0.38);
  G.barV = new THREE.BoxGeometry(0.12, 0.4, 0.38);
  G.handle = new THREE.TorusGeometry(0.13, 0.03, 6, 14, Math.PI);
  G.ring = new THREE.RingGeometry(0.55, 0.75, 32);
  G.beam = new THREE.CylinderGeometry(0.18, 0.4, 6, 12, 1, true);
  G.metal = new THREE.MeshStandardMaterial({ color: 0xd8dde4, metalness: 0.8, roughness: 0.25 });
  G.white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 0.25 });
  G.red = new THREE.MeshStandardMaterial({ color: 0xe8282a, roughness: 0.4, emissive: 0xe8282a, emissiveIntensity: 0.4 });
  return G;
}

function makeMesh(type) {
  const g = shared();
  const it = HEAL_ITEMS[type];
  const col = new THREE.Color(it.color);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  if (type === 'drink') {
    // lata de bebida energética: cuerpo de color, tapas metálicas y un rayo pintado
    const can = new THREE.Mesh(g.can, new THREE.MeshStandardMaterial({ color: col, roughness: 0.3, metalness: 0.4, emissive: col, emissiveIntensity: 0.35 }));
    can.castShadow = true;
    body.add(can);
    for (const s of [1, -1]) { const t = new THREE.Mesh(g.canTop, g.metal); t.position.y = s * 0.33; body.add(t); }
    const bolt = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.34), new THREE.MeshBasicMaterial({ color: 0xffe94a, side: THREE.DoubleSide }));
    bolt.position.z = 0.205; bolt.rotation.z = 0.35;
    body.add(bolt);
    const bolt2 = bolt.clone(); bolt2.position.z = -0.205; body.add(bolt2);
  } else {
    // maletín de botiquín: el normal es blanco con cruz roja; los especiales, de su color con cruz blanca
    const special = type !== 'kit';
    const boxMat = special ? new THREE.MeshStandardMaterial({ color: col, roughness: 0.35, emissive: col, emissiveIntensity: 0.45 }) : g.white;
    const box = new THREE.Mesh(g.box, boxMat);
    box.castShadow = true;
    body.add(box);
    const crossMat = special ? g.white : g.red;
    for (const z of [0.01, -0.01]) {
      const h = new THREE.Mesh(g.barH, crossMat); h.scale.z = 1.06 + z; body.add(h);
      const v = new THREE.Mesh(g.barV, crossMat); v.scale.z = 1.06 + z; body.add(v);
    }
    const handle = new THREE.Mesh(g.handle, g.metal);
    handle.position.y = 0.25;
    body.add(handle);
    if (special) {
      // etiqueta con el porcentaje sobre el maletín
      const c = document.createElement('canvas'); c.width = 128; c.height = 64;
      const x = c.getContext('2d');
      x.fillStyle = 'rgba(0,0,0,.55)'; x.beginPath(); x.roundRect(4, 6, 120, 52, 14); x.fill();
      x.fillStyle = it.color; x.font = 'bold 38px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(it.short.replace(' ', ''), 64, 33);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthWrite: false }));
      sp.scale.set(0.8, 0.4, 1);
      sp.position.y = 0.72;
      root.add(sp);
    }
  }
  // anillo en el suelo y haz de luz suave para verlo desde lejos
  const ring = new THREE.Mesh(g.ring, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -0.6;
  root.add(ring);
  const beam = new THREE.Mesh(g.beam, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  beam.position.y = 2.4;
  root.add(beam);
  return { root, body, ring, beam };
}

export class Pickups {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.items = [];
    this.t = 0;
  }
  clear() {
    for (const p of this.items) this.group.remove(p.mesh.root);
    this.items = [];
  }
  add(type, x, y, z, pid, { persist = true } = {}) {
    const mesh = makeMesh(type);
    mesh.root.position.set(x, y + 0.75, z);
    this.group.add(mesh.root);
    const p = { type, x, y, z, pid, persist, mesh, ph: Math.random() * TAU, fullT: 0, alive: true };
    this.items.push(p);
    return p;
  }

  // Reparto en el mapa: puntos de interés, caminos secundarios y rincones accesibles (posiciones estables por nivel)
  placeLevel(level, world, avoid = []) {
    this.clear();
    const picked = Save.pickedIn(level.id);
    const reach = world.reach;
    const S = CFG.SAFE, T = CFG.START;
    const arena = world.sc.bossArena || { x: S.x, z: S.z - 18, r: 16 };
    const ok = [];
    (world.candidates || []).forEach((c, i) => {
      if (c.needsTool) return;
      const { x, y, z } = c;
      if (Math.abs(x) > 106 || Math.abs(z) > 106) return;
      if (Math.hypot(x - T.x, z - T.z) < 9) return;
      if (Math.hypot(x - S.x, z - S.z) < (S.r || 8) + 3) return;
      if (world.noSpawn && world.noSpawn(x, z)) return;
      if (!clearAt(world, x, y, z)) return;
      if (reach && !reach.isReachable(x, y, z)) return;
      ok.push({ x, y, z, i, dArena: Math.hypot(x - arena.x, z - arena.z) });
    });
    const rng = makeRng(hashStr(level.id + ':pickups'));
    for (let i = ok.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [ok[i], ok[j]] = [ok[j], ok[i]]; }
    const types = [];
    for (const [type, n] of Object.entries(PICKUP_SPAWN.perLevel)) for (let k = 0; k < n; k++) types.push(type);
    const chosen = [];
    const far = (c, sep) => chosen.every((o) => Math.hypot(o.x - c.x, o.z - c.z) >= sep) && avoid.every((v) => Math.hypot(v.x - c.x, v.z - c.z) >= 2.5);
    const take = (filter, sep) => {
      const idx = ok.findIndex((c) => filter(c) && far(c, sep));
      if (idx < 0) return null;
      return ok.splice(idx, 1)[0];
    };
    // antes del jefe: un botiquín y una bebida cerca de la zona del combate final
    const preBoss = level.boss ? ['kit', 'drink'] : [];
    for (const type of preBoss) {
      const c = take((q) => q.dArena > arena.r + 3 && q.dArena < arena.r + 34, 6);
      if (c) { chosen.push({ ...c, type }); types.splice(types.indexOf(type), 1); }
    }
    // el resto, repartido por el mapa (separados entre sí para invitar a explorar)
    for (const type of types) {
      let c = null;
      for (const sep of [22, 14, 8, 4]) { c = take(() => true, sep); if (c) break; }
      if (c) chosen.push({ ...c, type });
    }
    for (const c of chosen) {
      const pid = `c${c.i}`;
      if (picked.has(pid)) continue; // ya recogido en otra partida: no se duplica
      this.add(c.type, c.x, c.y, c.z, pid);
    }
    return this.items.length;
  }
  // Objetos dentro de la arena del jefe (se pueden recoger durante el combate)
  placeArena(level, arena) {
    const picked = Save.pickedIn(level.id);
    PICKUP_SPAWN.arena.forEach((type, k) => {
      const pid = `a${k}`;
      if (picked.has(pid)) return;
      const a = 0.9 + k * Math.PI, r = arena.r * 0.62;
      const x = arena.x + Math.cos(a) * r, z = arena.z + Math.sin(a) * r;
      this.add(type, x, terrainH(x, z), z, pid);
    });
  }
  // Botín que deja un NPC derrotado (no se guarda como recogido: es temporal)
  drop(type, x, z) {
    return this.add(type, x, terrainH(x, z), z, `drop${Math.random().toString(36).slice(2, 7)}`, { persist: false });
  }

  update(dt, player, onPick, onFull) {
    this.t += dt;
    const R = PICKUP_SPAWN.radius;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      const m = p.mesh;
      m.body.rotation.y += dt * 1.8;
      m.body.position.y = Math.sin(this.t * 2.4 + p.ph) * 0.12;
      m.ring.scale.setScalar(1 + Math.sin(this.t * 3 + p.ph) * 0.08);
      p.fullT = Math.max(0, p.fullT - dt);
      const d = Math.hypot(player.pos.x - p.x, player.pos.z - p.z);
      if (d > R || Math.abs(player.pos.y - p.y) > 2.4) continue;
      if (!onPick(p)) { // almacenamiento lleno: el objeto permanece en el escenario
        if (p.fullT <= 0) { p.fullT = 3; onFull(p); }
        continue;
      }
      if (p.persist) Save.markPicked(this.game.mission.id, p.pid);
      this.group.remove(m.root);
      this.items.splice(i, 1);
    }
  }
}
