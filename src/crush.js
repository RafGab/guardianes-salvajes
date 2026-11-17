import * as THREE from 'three';
import { terrainH, CFG } from './terrain.js';
import { HEALTH } from './skills/config.js';

// APLASTAMIENTO (todos los mundos): de vez en cuando cae un objeto pesado propio del escenario cerca del héroe.
// Primero se ve su sombra creciendo en el suelo (aviso), después cae y, si alcanza al héroe sin escudo, lo aplasta
// (daño + el héroe se aplasta y se recupera). Con el escudo activo NO hay daño ni aplastamiento: el objeto rebota.
// Un mismo objeto solo puede golpear una vez. Después queda unos segundos en el suelo como obstáculo sólido
// (no se atraviesa) y se hunde. Se AÑADE a los peligros de cada mundo, sin cambiar nada de lo que ya hay.
const rnd = (a, b) => a + Math.random() * (b - a);
const WARN = 1.25;   // segundos de aviso (sombra) antes de que caiga
const DROP_H = 14;   // altura desde la que cae

// objetos de cada mundo: forma, tamaño, colores y efectos al caer
const THEMES = {
  campfire: { label: '🔥 ¡Una rama en llamas te aplasta!', items: [{ kind: 'log', col: 0x3a2618, r: 0.8, burn: true }, { kind: 'log', col: 0x2a1c12, r: 0.65, burn: true }] },
  sandstorm: { label: '🧱 ¡Un bloque de adobe te aplasta!', items: [{ kind: 'block', col: 0xc79a62, r: 0.8 }, { kind: 'slab', col: 0xb88654, r: 0.9 }] },
  quake: { label: '🏚️ ¡Un bloque del edificio te aplasta!', items: [{ kind: 'block', col: 0x8a7a6a, r: 0.85 }, { kind: 'slab', col: 0x9a5a3a, r: 0.95 }] },
  rockslide: { label: '🪨 ¡Una roca te aplasta!', items: [{ kind: 'rock', col: 0x6b6c76, r: 0.9 }, { kind: 'rock', col: 0x5c5d66, r: 1.1 }] },
  hurricane: { label: '🌀 ¡Un objeto arrastrado por el viento te aplasta!', items: [{ kind: 'crate', col: 0x8a6a42, r: 0.75 }, { kind: 'slab', col: 0x3a6aa8, r: 0.9 }] },
  flood: { label: '🌊 ¡Un tronco del muelle te aplasta!', items: [{ kind: 'crate', col: 0x7a5a38, r: 0.75 }, { kind: 'log', col: 0x5a4028, r: 0.8 }] },
  fire: { label: '🌋 ¡Una bomba volcánica te aplasta!', items: [{ kind: 'rock', col: 0x2a2222, r: 0.85, lava: true }, { kind: 'rock', col: 0x1e1a1a, r: 0.7, lava: true }] },
  ice: { label: '🧊 ¡Un bloque de hielo te aplasta!', items: [{ kind: 'ice', col: 0x9cd2f0, r: 0.85 }, { kind: 'ice', col: 0xbfe2f6, r: 0.7 }] },
  extreme: { label: '☄️ ¡Un fragmento de meteorito te aplasta!', items: [{ kind: 'rock', col: 0x1c1816, r: 0.95, lava: true, meteor: true }, { kind: 'rock', col: 0x2a2220, r: 0.75, lava: true, meteor: true }] },
};

export class CrushHazard {
  constructor(ctx, scenario) {
    this.ctx = ctx;
    this.theme = THEMES[scenario] || THEMES.rockslide;
    this.group = new THREE.Group();
    ctx.scene.add(this.group);
    this.geo = {
      rock: (() => { const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position, v = new THREE.Vector3(); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const k = 0.82 + 0.3 * Math.abs(Math.sin(v.x * 6.1 + v.y * 4.3 + v.z * 8.7)); p.setXYZ(i, v.x * k, v.y * k * 0.85, v.z * k); } g.computeVertexNormals(); return g; })(),
      block: new THREE.BoxGeometry(1.5, 1.1, 1.2),
      slab: new THREE.BoxGeometry(2.2, 0.45, 1.5),
      crate: new THREE.BoxGeometry(1.3, 1.3, 1.3),
      log: (() => { const g = new THREE.CylinderGeometry(0.45, 0.5, 2.6, 9); g.rotateZ(Math.PI / 2); return g; })(),
      ice: new THREE.IcosahedronGeometry(1, 0),
    };
    // sombra de aviso: un disco oscuro que crece y un anillo rojo que se cierra
    this.shadowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(0,0,0,0.8)'); gr.addColorStop(0.7, 'rgba(0,0,0,0.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
    this.reset();
  }
  reset() {
    for (const o of this.list || []) this.remove(o);
    this.list = [];
    this.next = rnd(10, 16);
  }
  remove(o) {
    this.group.remove(o.mesh, o.shadow, o.ring);
    if (o.solid) { const W = this.ctx.world, i = W.dynSolids.indexOf(o.solid); if (i >= 0) W.dynSolids.splice(i, 1); }
    o.mesh.material.dispose(); o.shadow.material.dispose(); o.ring.material.dispose();
  }
  spawn() {
    const { player } = this.ctx, P = player.pos;
    // cae cerca del héroe: a veces justo donde está (hay que apartarse), otras a su lado
    const onTop = Math.random() < 0.45;
    const a = rnd(0, Math.PI * 2), r = onTop ? rnd(0, 0.6) : rnd(2.5, 6);
    const lead = onTop ? 0.6 : 0; // apunta un poco por delante si va corriendo
    const x = P.x + Math.cos(a) * r + player.vx * lead, z = P.z + Math.sin(a) * r + player.vz * lead;
    const S = CFG.SAFE;
    if (S && Math.hypot(x - S.x, z - S.z) < S.r + 3) return; // nunca dentro del refugio
    const gy = terrainH(x, z);
    if (Math.abs(gy - P.y) > 4) return;
    const it = this.theme.items[Math.floor(Math.random() * this.theme.items.length)];
    const mat = new THREE.MeshStandardMaterial({ color: it.col, roughness: it.kind === 'ice' ? 0.15 : 0.9, metalness: it.kind === 'ice' ? 0.1 : 0, flatShading: it.kind !== 'log', emissive: it.lava ? 0xff4a10 : 0x000000, emissiveIntensity: it.lava ? 0.35 : 0, transparent: it.kind === 'ice', opacity: it.kind === 'ice' ? 0.92 : 1 });
    const mesh = new THREE.Mesh(this.geo[it.kind], mat);
    const s = it.r * rnd(0.85, 1.15);
    mesh.scale.setScalar(it.kind === 'rock' || it.kind === 'ice' ? s : s * 0.75);
    mesh.position.set(x, gy + DROP_H, z);
    mesh.rotation.set(rnd(0, 3), rnd(0, 6), rnd(0, 3));
    mesh.castShadow = true; mesh.visible = false;
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false, opacity: 0 }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.set(x, gy + 0.06, z); shadow.renderOrder = 3;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 40), new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, gy + 0.08, z); ring.renderOrder = 3;
    this.group.add(mesh, shadow, ring);
    const rad = s * (it.kind === 'slab' || it.kind === 'log' ? 1.25 : 1.05);
    this.list.push({ it, mesh, shadow, ring, x, z, gy, t: 0, rad, size: s, state: 'warn', vy: 0, hit: false, spin: new THREE.Vector3(rnd(-3, 3), rnd(-3, 3), rnd(-3, 3)) });
  }
  update(dt) {
    const { ctx } = this, g = ctx.game;
    if (!g || g.state !== 'playing' || g.boss) return;
    const hz = ctx.hz || 1;
    this.next -= dt;
    if (this.next <= 0) { this.next = rnd(11, 18) / Math.max(0.8, Math.min(1.6, hz)); this.spawn(); }
    const P = ctx.player.pos, fx = ctx.fx;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const o = this.list[i];
      o.t += dt;
      if (o.state === 'warn') {
        const k = Math.min(1, o.t / WARN);
        o.shadow.scale.setScalar(o.rad * 2.4 * (0.4 + 0.6 * k));
        o.shadow.material.opacity = 0.65 * k;
        o.ring.scale.setScalar(o.rad * (2.6 - 1.4 * k));
        o.ring.material.opacity = 0.8 * Math.min(1, k * 2) * (0.6 + 0.4 * Math.sin(o.t * 18));
        if (o.t > WARN - 0.55 && !o.mesh.visible) { o.mesh.visible = true; o.vy = -6; } // aparece arriba y empieza a caer
        if (o.mesh.visible) {
          o.vy -= 30 * dt;
          o.mesh.position.y += o.vy * dt;
          o.mesh.rotation.x += o.spin.x * dt; o.mesh.rotation.z += o.spin.z * dt;
          if (o.it.burn && Math.random() < 0.7) fx.flame(o.mesh.position.x, o.mesh.position.y, o.mesh.position.z, 0.5, 0.3);
          if (o.it.meteor && Math.random() < 0.8) { fx.smokePuff(o.mesh.position.x, o.mesh.position.y + 0.4, o.mesh.position.z, 0.6, 0x2a2420); fx.ember(o.mesh.position.x, o.mesh.position.y, o.mesh.position.z, 1); }
        }
        if (o.mesh.visible && o.mesh.position.y <= o.gy + o.size * 0.6) this.land(o, P);
        continue;
      }
      // en el suelo: obstáculo sólido unos segundos, después se hunde y desaparece
      if (o.t > 4.5) {
        o.mesh.position.y -= dt * 0.8;
        if (o.solid) { const W = ctx.world, k = W.dynSolids.indexOf(o.solid); if (k >= 0) W.dynSolids.splice(k, 1); o.solid = null; }
      }
      o.shadow.material.opacity = Math.max(0, o.shadow.material.opacity - dt * 2);
      o.ring.material.opacity = 0;
      if (o.t > 6) { this.remove(o); this.list.splice(i, 1); }
    }
  }
  land(o, P) {
    const { ctx } = this, g = ctx.game, fx = ctx.fx, player = ctx.player;
    o.state = 'ground'; o.t = 0;
    o.mesh.position.y = o.gy + o.size * 0.55;
    ctx.chase.shake(Math.min(0.35, 0.12 + 0.4 / (1 + Math.hypot(o.x - P.x, o.z - P.z))));
    for (let i = 0; i < 8; i++) fx.dustPuff(o.x + rnd(-o.rad, o.rad), o.gy + 0.1, o.z + rnd(-o.rad, o.rad), 1.3);
    for (let i = 0; i < 6; i++) fx.rock(o.x, o.gy + 0.3, o.z);
    if (o.it.kind === 'ice') for (let i = 0; i < 10; i++) fx.iceShard(o.x, o.gy + 0.3, o.z, 1);
    if (o.it.lava || o.it.burn) for (let i = 0; i < 8; i++) fx.ember(o.x, o.gy + 0.3, o.z, 1.2);
    if (ctx.audio && ctx.audio.noiseBurst) ctx.audio.noiseBurst(0.5, 120, 0.4, 'lowpass');
    // ¿aplasta al héroe? (una sola vez por objeto)
    const d = Math.hypot(o.x - P.x, o.z - P.z);
    if (!o.hit && d < o.rad + player.R * 0.8 && P.y < o.gy + 2.2) {
      o.hit = true;
      if (g.shielded) {
        // el escudo lo para: sin daño ni aplastamiento, el objeto rebota hacia fuera
        g.shieldBlock({ x: o.x, z: o.z });
        const ux = (o.x - P.x) / (d || 1), uz = (o.z - P.z) / (d || 1);
        o.x += ux * (o.rad + player.R + 0.3); o.z += uz * (o.rad + player.R + 0.3);
        o.gy = terrainH(o.x, o.z);
        o.mesh.position.set(o.x, o.gy + o.size * 0.55, o.z);
      } else if (g.hurtHero(HEALTH.crush, { from: { x: o.x, z: o.z }, label: this.theme.label, sub: 'Mira las sombras del suelo y apártate · el escudo te protege' })) {
        player.crushT = 0.75; // el héroe se aplasta y se recupera
        // lo saca de debajo del objeto
        const ux = (P.x - o.x) / (d || 1), uz = (P.z - o.z) / (d || 1);
        P.x = o.x + ux * (o.rad + player.R + 0.15); P.z = o.z + uz * (o.rad + player.R + 0.15);
      }
    }
    // sólido: el héroe no lo atraviesa
    const r = o.rad * 0.8, top = o.gy + o.size * 1.1;
    o.solid = { x0: o.x - r, x1: o.x + r, y0: o.gy - 1, y1: top, z0: o.z - r, z1: o.z + r, tag: 'rubble', dyn: true, dx: 0, dy: 0, dz: 0, _q: 0 };
    ctx.world.dynSolids.push(o.solid);
  }
  dispose() {
    for (const o of this.list || []) this.remove(o);
    this.list = [];
    this.ctx.scene.remove(this.group);
    for (const k in this.geo) this.geo[k].dispose();
    this.shadowTex.dispose();
  }
}
