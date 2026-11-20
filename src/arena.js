import * as THREE from 'three';
import { setTerrain, getTerrain } from './terrain.js';

/* ======================================================================
   ARENAS DE COMBATE DE LOS JEFES (escenario propio, separado del de rescate)
   Al terminar el rescate, el combate ya no ocurre DENTRO del escenario de exploración (donde el héroe y el jefe
   podían quedar atrapados entre edificios, agua, desniveles u obstáculos). Se pasa a una arena exclusiva:
   · suelo llano, amplio y despejado, a gran altura (sin agua ni lava del escenario debajo);
   · el escenario de exploración se oculta y sus colisiones, peligros, orcos y personas quedan en pausa;
   · la arena conserva la identidad del mundo: colores del suelo, cielo, niebla, clima y decoración de su mundo,
     siempre FUERA del círculo de combate (nada estorba a la cámara, al movimiento ni a los ataques).
   Al salir (victoria, derrota o reintento) todo vuelve exactamente a como estaba.
   ====================================================================== */
export const ARENA = { x: 0, z: 0, y: 60, r: 18, floorR: 46, wallR: 24 };

// paleta y decoración de cada mundo (reutiliza la estética del escenario: tonos del suelo y elementos típicos)
const THEME = {
  campfire: { base: '#5f7a3a', mid: '#7a8a46', line: '#ffb060', glow: 0xff6a1a, deco: 'pines', rock: 0x6a5a48 },
  sandstorm: { base: '#c89a58', mid: '#e0b878', line: '#ffe0a0', glow: 0xffc040, deco: 'cactus', rock: 0xb08050 },
  quake: { base: '#7a6a58', mid: '#8a7a64', line: '#ffb070', glow: 0xff8a3a, deco: 'columns', rock: 0x6e5e4c },
  rockslide: { base: '#6a7078', mid: '#80868e', line: '#b0ffb8', glow: 0x6aff8a, deco: 'boulders', rock: 0x60666e },
  hurricane: { base: '#5a7a8a', mid: '#6a8a9a', line: '#a8e0ff', glow: 0x6ac8ff, deco: 'palms', rock: 0x707a80 },
  flood: { base: '#3a5a6a', mid: '#4a7080', line: '#7ae0ff', glow: 0x3ab8ff, deco: 'pools', rock: 0x4a5a64 },
  fire: { base: '#2a2220', mid: '#3a2c28', line: '#ff7a2a', glow: 0xff4a10, deco: 'lava', rock: 0x2a2424 },
  ice: { base: '#d8e8f4', mid: '#c0d6ea', line: '#c8a8ff', glow: 0xa080ff, deco: 'crystals', rock: 0xb8c8d8 },
  extreme: { base: '#2a2630', mid: '#3a3442', line: '#d080ff', glow: 0xa04aff, deco: 'shards', rock: 0x3a3440 },
};

function floorTexture(t) {
  const c = document.createElement('canvas'); c.width = c.height = 1024;
  const x = c.getContext('2d'), g = x.createRadialGradient(512, 512, 40, 512, 512, 512);
  g.addColorStop(0, t.mid); g.addColorStop(0.75, t.base); g.addColorStop(1, t.base);
  x.fillStyle = g; x.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 2600; i++) { // grano del suelo (arena, roca, nieve...)
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 500;
    x.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${0.04 + Math.random() * 0.07})`;
    x.fillRect(512 + Math.cos(a) * r, 512 + Math.sin(a) * r, 2 + Math.random() * 5, 2 + Math.random() * 5);
  }
  // círculo de combate y runas del borde (marca el espacio de lucha)
  const rr = (ARENA.r / ARENA.floorR) * 512;
  x.strokeStyle = t.line; x.globalAlpha = 0.55; x.lineWidth = 7;
  x.beginPath(); x.arc(512, 512, rr, 0, Math.PI * 2); x.stroke();
  x.lineWidth = 2; x.globalAlpha = 0.35;
  x.beginPath(); x.arc(512, 512, rr * 0.55, 0, Math.PI * 2); x.stroke();
  for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; x.beginPath(); x.moveTo(512 + Math.cos(a) * (rr - 14), 512 + Math.sin(a) * (rr - 14)); x.lineTo(512 + Math.cos(a) * (rr + 14), 512 + Math.sin(a) * (rr + 14)); x.stroke(); }
  x.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

// decoración del borde (siempre fuera del círculo de combate): misma silueta típica de cada mundo
function decorate(group, t, own) {
  const A = ARENA, std = (c, o = {}) => { const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, flatShading: true, ...o }); own.push(m); return m; };
  const geo = (g) => { own.push(g); return g; };
  const rock = std(t.rock), dark = std(0x3a2a1a), green = std(0x2f6a34), glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(t.glow).multiplyScalar(1.6), toneMapped: false });
  own.push(glow);
  const ring = (n, r0, r1, make) => { for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + Math.random() * 0.2, r = r0 + Math.random() * (r1 - r0); const o = make(i); o.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); o.rotation.y = Math.random() * 6; group.add(o); } };
  // anillo de rocas bajas que cierra la arena (entre el círculo y el horizonte)
  const rg = geo(new THREE.DodecahedronGeometry(1, 0));
  ring(34, A.wallR, A.wallR + 4, () => { const m = new THREE.Mesh(rg, rock); const s = 0.8 + Math.random() * 1.6; m.scale.set(s * 1.3, s, s); m.position.y = s * 0.3; m.castShadow = true; return m; });
  const cone = geo(new THREE.ConeGeometry(1, 1, 7)), cyl = geo(new THREE.CylinderGeometry(1, 1, 1, 8)), oct = geo(new THREE.OctahedronGeometry(1, 0));
  const make = {
    pines: () => { const g = new THREE.Group(); const h = 6 + Math.random() * 5; const tr = new THREE.Mesh(cyl, dark); tr.scale.set(0.25, 2, 0.25); tr.position.y = 1; g.add(tr); for (let k = 0; k < 3; k++) { const c = new THREE.Mesh(cone, green); c.scale.set(2 - k * 0.5, h * 0.35, 2 - k * 0.5); c.position.y = 2 + k * h * 0.22; g.add(c); } return g; },
    cactus: () => { const g = new THREE.Group(); const c = new THREE.Mesh(cyl, std(0x4a8a3a)); c.scale.set(0.4, 3 + Math.random() * 2, 0.4); c.position.y = c.scale.y / 2; g.add(c); return g; },
    columns: () => { const g = new THREE.Group(); const c = new THREE.Mesh(cyl, rock); const h = 3 + Math.random() * 4; c.scale.set(0.8, h, 0.8); c.position.y = h / 2; c.rotation.z = (Math.random() - 0.5) * 0.3; g.add(c); return g; },
    boulders: () => { const g = new THREE.Group(); const m = new THREE.Mesh(rg, rock); const s = 1.8 + Math.random() * 2; m.scale.set(s, s * 0.8, s); m.position.y = s * 0.4; g.add(m); const e = new THREE.Mesh(oct, glow); e.scale.set(0.2, 0.6, 0.2); e.position.y = s * 0.9; g.add(e); return g; },
    palms: () => { const g = new THREE.Group(); const h = 6 + Math.random() * 3; const tr = new THREE.Mesh(cyl, std(0x8a6a44)); tr.scale.set(0.25, h, 0.25); tr.position.y = h / 2; tr.rotation.z = 0.15; g.add(tr); for (let k = 0; k < 6; k++) { const l = new THREE.Mesh(cone, green); l.scale.set(0.4, 3, 0.4); l.position.set(0, h, 0); l.rotation.set(1.3, (k / 6) * Math.PI * 2, 0); g.add(l); } return g; },
    pools: () => { const g = new THREE.Group(); const w = new THREE.Mesh(geo(new THREE.CircleGeometry(2.5, 24)), std(0x2a8ab8, { roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.8 })); w.rotation.x = -Math.PI / 2; w.position.y = 0.05; g.add(w); return g; },
    lava: () => { const g = new THREE.Group(); const l = new THREE.Mesh(geo(new THREE.CircleGeometry(2 + Math.random(), 20)), glow); l.rotation.x = -Math.PI / 2; l.position.y = 0.04; g.add(l); const r = new THREE.Mesh(rg, rock); r.scale.set(1.4, 2.2, 1.4); r.position.set(2.4, 1, 0); g.add(r); return g; },
    crystals: () => { const g = new THREE.Group(); const m = std(0xcfe8ff, { emissive: 0x6a5aff, emissiveIntensity: 0.35, roughness: 0.1, metalness: 0.2 }); for (let k = 0; k < 3; k++) { const c = new THREE.Mesh(oct, m); const h = 2 + Math.random() * 3; c.scale.set(0.6, h, 0.6); c.position.set((k - 1) * 0.8, h * 0.7, Math.random()); c.rotation.z = (k - 1) * 0.3; g.add(c); } return g; },
    shards: () => { const g = new THREE.Group(); const c = new THREE.Mesh(oct, glow); const h = 2 + Math.random() * 3; c.scale.set(0.5, h, 0.5); c.position.y = h + 1; g.add(c); return g; },
  }[t.deco];
  if (make) ring(16, A.wallR + 5, A.floorR - 6, make);
  // aro luminoso del borde del combate (del color del mundo)
  const edge = new THREE.Mesh(geo(new THREE.TorusGeometry(A.r, 0.06, 6, 128)), glow);
  edge.rotation.x = Math.PI / 2; edge.position.y = 0.06;
  group.add(edge);
}

export class BossArena {
  constructor(game) { this.game = game; this.on = false; }
  get active() { return this.on; }
  // entra en la arena: guarda el estado del escenario de exploración y lo deja en pausa (oculto y sin colisiones)
  enter(mission) {
    if (this.on) return;
    const g = this.game, scene = g.scene, w = g.world;
    const keep = new Set([w.sky && (w.sky.mesh || w.sky.group || w.sky), w.backdrop && (w.backdrop.group || w.backdrop.root || w.backdrop), g.vfx && g.vfx.group, g.player.model && g.player.model.root].filter(Boolean));
    if (g.fxKids) for (const o of g.fxKids) keep.add(o);
    this.hidden = [];
    this.keep = keep;
    this.wasHidden = new Map(); // objetos que sus sistemas vuelven a mostrar (marcadores, objetos del mapa): se ocultan cada fotograma
    for (const o of scene.children) {
      if (keep.has(o) || o.isLight || o.isCamera || o.userData.arenaKeep) continue;
      if (w.sun && o === w.sun.target) continue;
      if (!o.visible) { this.wasHidden.set(o, false); continue; }
      o.visible = false; this.hidden.push(o);
    }
    // terreno y colisiones de la arena: suelo llano, sin sólidos del escenario
    this.savedSolids = w.solidsNear;
    this.savedWater = w.waterY;
    const Y = ARENA.y;
    this.prevFn = getTerrain();
    setTerrain(() => Y);
    w.solidsNear = (x0, x1, z0, z1, out) => { if (out) out.length = 0; return out || []; };
    // la arena con la estética de su mundo
    const t = THEME[mission.id] || THEME.extreme;
    this.own = [];
    const grp = new THREE.Group(); grp.position.set(ARENA.x, Y, ARENA.z);
    const fg = new THREE.CircleGeometry(ARENA.floorR, 96); fg.rotateX(-Math.PI / 2); this.own.push(fg);
    const ftex = floorTexture(t);
    const fm = new THREE.MeshStandardMaterial({ map: ftex, roughness: 0.92 }); this.own.push(fm, ftex);
    const floor = new THREE.Mesh(fg, fm); floor.receiveShadow = true; grp.add(floor);
    // falda de roca bajo el borde (la arena es una meseta: no se ve el vacío)
    const sg = new THREE.CylinderGeometry(ARENA.floorR, ARENA.floorR * 0.75, 30, 64, 1, true); sg.translate(0, -15.02, 0); this.own.push(sg);
    const sm = new THREE.MeshStandardMaterial({ color: t.rock, roughness: 0.95, flatShading: true, side: THREE.DoubleSide }); this.own.push(sm);
    grp.add(new THREE.Mesh(sg, sm));
    decorate(grp, t, this.own);
    grp.userData.arenaKeep = true;
    scene.add(grp);
    this.group = grp;
    this.on = true;
  }
  // cada fotograma en la arena: lo del escenario de exploración que otro sistema vuelva a mostrar (iconos «!», objetos
  // recogibles del mapa, marcadores) se mantiene oculto; lo que pertenece al combate (a la altura de la arena) se ve
  tick() {
    if (!this.on) return;
    const sc = this.game.scene, own = this.game.world.ownKids, lowY = ARENA.y - 12;
    for (const o of sc.children) {
      if (!o.visible || o === this.group || this.keep.has(o) || o.isLight || o.isCamera) continue;
      if (own && own.has(o) && !o.userData.arenaKeep) { if (!this.wasHidden.has(o) && !this.hidden.includes(o)) this.wasHidden.set(o, true); o.visible = false; continue; }
      // objetos del juego (jefe, compañeros, recogibles, marcadores): solo se oculta lo que esté abajo, en el mapa de exploración
      o.updateWorldMatrix(true, false);
      const atOrigin = (m) => m.elements[12] === 0 && m.elements[13] === 0 && m.elements[14] === 0; // geometría en coordenadas de mundo (partículas, estelas): no
      if (!o.children.length || o.isSprite || o.isMesh) { if ((o.isSprite || o.isMesh) && !atOrigin(o.matrixWorld) && o.matrixWorld.elements[13] < lowY) { o.visible = false; this.wasHidden.set(o, true); } continue; }
      for (const c of o.children) {
        if (!c.visible || c.isLight || c.isPoints || c.isLine) continue;
        c.updateWorldMatrix(true, false);
        if (!atOrigin(c.matrixWorld) && c.matrixWorld.elements[13] < lowY) { c.visible = false; this.wasHidden.set(c, true); }
      }
    }
  }
  // mantiene al héroe y a sus compañeros dentro del espacio de combate (sin muros invisibles visibles: un borde suave)
  clamp(pos) {
    if (!this.on) return;
    const dx = pos.x - ARENA.x, dz = pos.z - ARENA.z, d = Math.hypot(dx, dz), lim = ARENA.wallR - 1.5;
    if (d > lim) { pos.x = ARENA.x + (dx / d) * lim; pos.z = ARENA.z + (dz / d) * lim; }
  }
  // sale: todo vuelve a como estaba (escenario visible, terreno, colisiones)
  exit() {
    if (!this.on) return;
    const g = this.game, w = g.world;
    for (const o of this.hidden || []) o.visible = true;
    for (const [o, v] of this.wasHidden || []) if (v) o.visible = true;
    this.hidden = []; this.wasHidden = new Map();
    if (this.prevFn) setTerrain(this.prevFn);
    w.solidsNear = this.savedSolids;
    if (this.group) { g.scene.remove(this.group); this.group = null; }
    for (const r of this.own || []) r.dispose && r.dispose();
    this.own = [];
    this.on = false;
  }
}
