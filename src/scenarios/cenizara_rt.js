import * as THREE from 'three';
import { ui } from '../ui.js';
import { Audio3D as audio } from '../audio.js';
import { HEALTH } from '../skills/config.js';
import { terrainH } from '../terrain.js';
import { pathDist } from './common.js';

/* ======================================================================
   CENIZARA · elementos vivos del escenario (los coleccionables y secretos los lleva CampFireRuntime)
   · Lava que fluye (río, ríos del volcán, lago, cráteres y charcos) y quema al pisarla (daño continuo)
   · Plataformas móviles: balsas de basalto que cruzan la lava, ascensores de piedra entre terrazas y
     plataformas colgantes que suben y bajan
   · Aspas de fuego giratorias: hay que calcular el momento (o saltarlas)
   · Cuerdas para subir y bajar paredes (la misma animación de cuerda del juego)
   · Géiseres de vapor que estallan cada pocos segundos y lanzan al héroe hacia arriba
   · Fumarolas, llamas, cascadas de lava, el cráter humeante, las luces del camión de bomberos y los
     soldados de Kerberos que guardan su puerta
   · Obstáculos destructibles (tablones, troncos y ramas quemadas) con el sistema del juego: se rompen
     con las armas y los poderes
   ====================================================================== */
const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
const LAVA_T = { value: 0 };

const LAVA_VS = `varying vec2 vUv; varying vec3 vW;
void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const LAVA_FS = `uniform float uT; uniform float uFlow; varying vec2 vUv; varying vec3 vW;
float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * n(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
void main(){
  vec2 p = uFlow > 0.5 ? vec2(vUv.x * 2.4, vUv.y * 1.5 - uT * 0.42) : vW.xz * 0.32 + vec2(uT * 0.05, uT * 0.035);
  float a = fbm(p * 1.2), b = fbm(p * 3.3 + vec2(0.0, uT * 0.25));
  float crust = smoothstep(0.47, 0.62, a + 0.12 * b);
  float vein = smoothstep(0.16, 0.0, abs(a - 0.47));
  vec3 hot = mix(vec3(1.0, 0.3, 0.03), vec3(1.0, 0.82, 0.32), clamp(vein + b * 0.35, 0.0, 1.0));
  vec3 dark = vec3(0.18, 0.045, 0.02) * (0.7 + 0.6 * b);
  vec3 col = mix(hot * 1.7, dark, crust * 0.86);
  col *= 0.82 + 0.18 * sin(uT * 2.2 + a * 9.0);
  if (uFlow > 0.5) col = mix(dark * 0.7, col, smoothstep(0.0, 0.14, vUv.x) * smoothstep(1.0, 0.86, vUv.x));
  gl_FragColor = vec4(col, 1.0);
}`;
// Material de lava compartido: `flow` fluye a lo largo de las cintas (uv), `pool` se mueve despacio en el plano
export function lavaMaterial() {
  const mk = (flow) => new THREE.ShaderMaterial({ uniforms: { uT: LAVA_T, uFlow: { value: flow } }, vertexShader: LAVA_VS, fragmentShader: LAVA_FS, side: THREE.DoubleSide });
  return { flow: mk(1), pool: mk(0) };
}

let GEO = null;
function geos() {
  if (GEO) return GEO;
  GEO = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
    chain: new THREE.CylinderGeometry(0.05, 0.05, 1, 5),
    ring: new THREE.TorusGeometry(1, 0.25, 6, 14),
    disc: new THREE.CircleGeometry(1, 20),
    ball: new THREE.SphereGeometry(0.16, 10, 8),
  };
  GEO.disc.rotateX(-Math.PI / 2);
  return GEO;
}

export class CenizaraRuntime {
  constructor(game, cfg) {
    this.g = game;
    this.cfg = cfg;
    this.t = 0;
    this.group = new THREE.Group();
    game.scene.add(this.group);
    const G = geos();
    this.M = {
      basalt: new THREE.MeshStandardMaterial({ color: 0x2a2422, roughness: 0.95, flatShading: true }),
      obsid: new THREE.MeshStandardMaterial({ color: 0x141012, roughness: 0.35, metalness: 0.3, flatShading: true }),
      glow: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff6a1a).multiplyScalar(1.8), toneMapped: false }),
      glowY: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb84a).multiplyScalar(1.6), toneMapped: false }),
      iron: new THREE.MeshStandardMaterial({ color: 0x3a3634, roughness: 0.6, metalness: 0.7 }),
      rope: new THREE.MeshStandardMaterial({ color: 0x9a7a4a, roughness: 0.95 }),
      steam: new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false }),
    };
    this.buildPlatforms(G);
    this.buildBlades(G);
    this.buildRopes(G);
    this.buildGeysers(G);
    this.buildBeacons(G);
    this.lights = [];
    for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xff6a20, 0, 20, 1.6); this.group.add(l); this.lights.push(l); }
    this.lightAcc = 9;
    // obstáculos destructibles con el sistema del juego (armas y poderes los rompen)
    const W = game.world;
    this.obstacles = (cfg.obstacles || []).map((o) => { const ob = W.addObstacle({ kind: o.kind, x: o.x, z: o.z, y: o.y, breakBy: 'axe', ry: o.ry || 0, size: o.size || 1 }); game.registerObstacle(ob); return ob; });
    this.hint = new Set();
    this.lavaHop = 0;
    this.fxAcc = 0;
  }

  /* ---------- plataformas móviles ---------- */
  buildPlatforms(G) {
    const W = this.g.world;
    this.platforms = (this.cfg.platforms || []).map((P) => {
      const m = new THREE.Group();
      const slab = new THREE.Mesh(G.box, P.kind === 'lift' ? this.M.basalt : this.M.obsid);
      slab.scale.set(P.w, 0.6, P.d); slab.position.y = -0.3; slab.castShadow = true; slab.receiveShadow = true;
      m.add(slab);
      // vetas de magma en el borde y runas encendidas
      for (const s of [-1, 1]) {
        const e = new THREE.Mesh(G.box, this.M.glow);
        e.scale.set(P.w * 0.9, 0.06, 0.08); e.position.set(0, -0.32, s * (P.d / 2 + 0.01));
        m.add(e);
      }
      if (P.kind === 'raft') { const r = new THREE.Mesh(G.box, this.M.glowY); r.scale.set(0.5, 0.04, 0.5); r.rotation.y = Math.PI / 4; r.position.y = 0.01; m.add(r); }
      if (P.kind === 'lift' || P.kind === 'hang') {
        // cadenas que sujetan la plataforma (las del ascensor llegan a lo alto de la pared)
        for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const c = new THREE.Mesh(G.chain, this.M.iron), L = P.kind === 'hang' ? 12 : 6;
          c.scale.y = L;
          c.position.set(sx * (P.w / 2 - 0.15), L / 2, sz * (P.d / 2 - 0.15));
          m.add(c);
        }
      }
      this.group.add(m);
      const s = { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0, tag: 'platform', dyn: true, dx: 0, dy: 0, dz: 0, _q: 0 };
      W.dynSolids.push(s);
      const it = { ...P, m, solid: s, cx: P.x, cy: P.y, cz: P.z, px: P.x, py: P.y, pz: P.z };
      this.placePlatform(it, 0, true);
      return it;
    });
  }
  platformPos(P, t) {
    const ph = t * P.sp + P.ph;
    if (P.axis === 'x') return [P.cx + Math.sin(ph) * P.amp, P.cy, P.cz];
    if (P.axis === 'z') return [P.cx, P.cy, P.cz + Math.sin(ph) * P.amp];
    if (P.kind === 'hang') return [P.cx, P.cy + Math.sin(ph) * P.amp, P.cz];
    // ascensor: sube, espera arriba, baja y espera abajo
    const f = 0.5 - 0.5 * Math.cos(ph);
    const k = Math.min(1, Math.max(0, (f - 0.1) / 0.8));
    return [P.cx, P.cy + 2 * P.amp * k * k * (3 - 2 * k), P.cz];
  }
  placePlatform(P, t, first = false) {
    const [x, y, z] = this.platformPos(P, t);
    const s = P.solid;
    s.dx = first ? 0 : x - P.px; s.dy = first ? 0 : y - P.py; s.dz = first ? 0 : z - P.pz;
    s.x0 = x - P.w / 2; s.x1 = x + P.w / 2; s.z0 = z - P.d / 2; s.z1 = z + P.d / 2; s.y0 = y - 0.6; s.y1 = y;
    P.px = x; P.py = y; P.pz = z;
    P.m.position.set(x, y, z);
  }

  /* ---------- aspas de fuego giratorias ---------- */
  buildBlades(G) {
    this.blades = (this.cfg.blades || []).map((B) => {
      const root = new THREE.Group();
      root.position.set(B.x, B.y, B.z);
      const hub = new THREE.Mesh(G.cyl, this.M.obsid); hub.scale.set(0.45, B.h + 0.5, 0.45); hub.position.y = (B.h + 0.5) / 2; hub.castShadow = true; root.add(hub);
      const base = new THREE.Mesh(G.cyl, this.M.basalt); base.scale.set(0.9, 0.3, 0.9); base.position.y = 0.15; root.add(base);
      const arm = new THREE.Group(); arm.position.y = B.h; root.add(arm);
      const bar = new THREE.Mesh(G.box, this.M.iron); bar.scale.set(B.len * 2, 0.22, 0.22); bar.castShadow = true; arm.add(bar);
      for (const s of [-1, 1]) {
        const edge = new THREE.Mesh(G.box, this.M.glow); edge.scale.set(B.len * 0.9, 0.08, 0.26); edge.position.x = s * B.len * 0.52; arm.add(edge);
        const tip = new THREE.Mesh(G.box, this.M.glowY); tip.scale.set(0.3, 0.3, 0.3); tip.position.x = s * B.len; arm.add(tip);
      }
      this.group.add(root);
      return { ...B, root, arm, a: Math.random() * TAU, cd: 0 };
    });
  }

  /* ---------- cuerdas ---------- */
  buildRopes(G) {
    this.ropes = (this.cfg.ropes || []).map((R) => {
      const [ax, ay, az] = R.anchor, [bx, by, bz] = R.bottom;
      const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by + 0.2, bz);
      const len = a.distanceTo(b);
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, len, 6), this.M.rope);
      rope.position.copy(a).add(b).multiplyScalar(0.5);
      rope.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), a.clone().sub(b).normalize());
      this.group.add(rope);
      // estaca de hierro arriba y nudos a lo largo de la cuerda
      const stake = new THREE.Mesh(G.cyl, this.M.iron); stake.scale.set(0.1, 0.8, 0.1); stake.position.set(ax, ay - 0.1, az); this.group.add(stake);
      for (let k = 1; k < len / 0.9; k++) { const kn = new THREE.Mesh(G.ball, this.M.rope); kn.position.copy(b).lerp(a, k * 0.9 / len); kn.scale.setScalar(0.7); this.group.add(kn); }
      // marca en el suelo: aro brillante al pie y en el borde
      const marks = [R.bottom, R.edge].map((p) => { const r = new THREE.Mesh(G.ring, this.M.glowY); r.rotation.x = Math.PI / 2; r.scale.setScalar(0.55); r.position.set(p[0], p[1] + 0.06, p[2]); this.group.add(r); return r; });
      return { ...R, marks, armed: true };
    });
  }

  /* ---------- géiseres ---------- */
  buildGeysers(G) {
    this.geysers = (this.cfg.geysers || []).map((Gy) => {
      const root = new THREE.Group(); root.position.set(Gy.x, Gy.y, Gy.z);
      for (let i = 0; i < 7; i++) { const a = i / 7 * TAU, r = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), this.M.basalt); r.scale.set(rnd(0.4, 0.6), rnd(0.3, 0.5), rnd(0.4, 0.6)); r.position.set(Math.cos(a) * 1.1, 0.15, Math.sin(a) * 1.1); root.add(r); }
      const hole = new THREE.Mesh(G.disc, this.M.glow); hole.scale.setScalar(0.65); hole.position.y = 0.05; root.add(hole);
      this.group.add(root);
      return { ...Gy, root, hole, state: 'idle', T: rnd(1.5, 5), acc: 0 };
    });
  }

  /* ---------- luces del camión de bomberos ---------- */
  buildBeacons(G) {
    this.beacons = (this.cfg.beacons || []).map(([x, y, z], i) => {
      const m = new THREE.Mesh(G.ball, new THREE.MeshBasicMaterial({ color: i % 2 ? 0x3a6aff : 0xff2a2a, toneMapped: false }));
      m.position.set(x, y, z); m.scale.setScalar(1.3);
      this.group.add(m);
      return m;
    });
  }

  /* ---------- lava ---------- */
  riverZ(x) {
    const P = this.cfg.lava.riverPts;
    for (let i = 0; i < P.length - 1; i++) if (x <= P[i + 1][0]) return P[i][1] + (P[i + 1][1] - P[i][1]) * Math.max(0, (x - P[i][0]) / (P[i + 1][0] - P[i][0]));
    return P[P.length - 1][1];
  }
  terraceY(z) { const L = this.cfg.lava; return z < L.W2 ? L.T[2] : z < L.W1 ? L.T[1] : L.T[0]; }
  // ¿pisa lava? devuelve la dirección para salir (o null)
  lavaAt(p) {
    const L = this.cfg.lava;
    const rz = this.riverZ(p.x);
    if (Math.abs(p.z - rz) < L.riverHalf && p.y < L.riverY + 1.1) return { x: 0, z: 1 };
    const onTer = p.z < rz - L.bank;
    if (onTer) for (const s of L.streams) {
      const d = pathDist(p.x, p.z, s);
      if (d.d < 2.3 && p.y < this.terraceY(p.z) - 0.55 + 0.9) { const l = d.d || 1; return { x: (p.x - d.x) / l, z: (p.z - d.z) / l }; }
    }
    for (const s of L.coneStreams) {
      const d = pathDist(p.x, p.z, s);
      if (d.d < 1.7 && p.y < terrainH(p.x, p.z) + 0.8) { const l = d.d || 1; return { x: (p.x - d.x) / l, z: (p.z - d.z) / l }; }
    }
    for (const o of L.pools) {
      const d = Math.hypot(p.x - o.x, p.z - o.z);
      if (d < o.r && !(o.hole && d < o.hole) && p.y < o.y + 0.9) { const l = d || 1; return { x: (p.x - o.x) / l, z: (p.z - o.z) / l }; }
    }
    return null;
  }

  banner(id, icon, text) {
    if (this.hint.has(id)) return;
    this.hint.add(id);
    ui.banner('find', icon, text);
  }

  /* ---------- actualización ---------- */
  update(dt, playing) {
    const g = this.g, P = g.player, p = P.pos, fx = g.fx, cam = g.camera.position;
    this.t += dt;
    const t = this.t;
    LAVA_T.value = t;
    // plataformas
    for (const pl of this.platforms) this.placePlatform(pl, t);
    // aspas
    for (const B of this.blades) {
      B.a += B.sp * dt;
      B.arm.rotation.y = -B.a;
      B.cd = Math.max(0, B.cd - dt);
      const dx = p.x - B.x, dz = p.z - B.z;
      const near = dx * dx + dz * dz < (B.len + 1) ** 2;
      if (near && Math.random() < dt * 8) { const s = Math.random() < 0.5 ? 1 : -1; fx.flame(B.x + Math.cos(B.a) * B.len * s, B.y + B.h, B.z + Math.sin(B.a) * B.len * s, 0.7, 0.05); }
      if (!playing || !near || B.cd > 0 || P.scripted) continue;
      const c = Math.cos(B.a), s = Math.sin(B.a);
      const along = dx * c + dz * s, perp = Math.abs(dx * s - dz * c);
      if (perp < 0.6 && Math.abs(along) < B.len + 0.3 && p.y < B.y + B.h + 0.3 && p.y + P.H > B.y + B.h - 0.2) {
        B.cd = 0.9;
        g.hitPlayer(1, new THREE.Vector3(B.x, B.y, B.z));
        const sg = Math.sign(B.sp) * Math.sign(along || 1);
        const tx = -s * sg, tz = c * sg, rl = Math.hypot(dx, dz) || 1;
        P.vx = tx * 7 + (dx / rl) * 3; P.vz = tz * 7 + (dz / rl) * 3; P.vy = Math.max(P.vy, 6); P.grounded = false; P.support = null;
        for (let i = 0; i < 10; i++) fx.sparkle(p.x, p.y + 1, p.z, 0xffa040, 3);
        audio.sfx('snap');
        this.banner('blade', '🔥', 'Aspas de fuego: espera el momento o sáltalas');
      }
    }
    // cuerdas
    if (playing && !P.scripted && !g.rope) {
      for (const R of this.ropes) {
        const db = Math.hypot(p.x - R.bottom[0], p.z - R.bottom[2]), de = Math.hypot(p.x - R.edge[0], p.z - R.edge[2]);
        if (!R.armed) { if (db > 2.6 && de > 2.6) R.armed = true; continue; }
        if (db < 1.0 && Math.abs(p.y - R.bottom[1]) < 1.3) this.climb(R, R.top, 'sube');
        else if (de < 0.9 && Math.abs(p.y - R.edge[1]) < 1.3) this.climb(R, [R.bottom[0], R.bottom[1], R.bottom[2]], 'baja');
      }
    }
    for (const R of this.ropes) for (const m of R.marks) { m.scale.setScalar(0.55 + 0.06 * Math.sin(t * 4)); }
    // géiseres
    for (const Gy of this.geysers) {
      Gy.T -= dt;
      const dCam = Math.hypot(cam.x - Gy.x, cam.z - Gy.z);
      const close = dCam < 75;
      if (Gy.state === 'idle') {
        if (close && Math.random() < dt * 2) fx.mist(Gy.x + rnd(-0.3, 0.3), Gy.y + 0.4, Gy.z + rnd(-0.3, 0.3), 0xd8d0c8, 0.8);
        if (Gy.T <= 0) { Gy.state = 'warn'; Gy.T = 0.9; }
      } else if (Gy.state === 'warn') {
        if (close && Math.random() < dt * 14) fx.spray(Gy.x + rnd(-0.4, 0.4), Gy.y + 0.2, Gy.z + rnd(-0.4, 0.4), rnd(-0.6, 0.6), rnd(2, 4), rnd(-0.6, 0.6), 0.6);
        Gy.hole.scale.setScalar(0.65 + 0.15 * Math.sin(t * 30));
        if (Gy.T <= 0) { Gy.state = 'erupt'; Gy.T = 1.5; if (dCam < 45) audio.sfx('hiss'); }
      } else {
        if (close) for (let i = 0; i < 3; i++) { fx.mist(Gy.x + rnd(-0.5, 0.5), Gy.y + rnd(0.5, 7), Gy.z + rnd(-0.5, 0.5), 0xf0ece6, 2.4); fx.spray(Gy.x, Gy.y + 0.5, Gy.z, rnd(-1.2, 1.2), rnd(9, 14), rnd(-1.2, 1.2), 1.1); }
        if (playing && !P.scripted && Math.hypot(p.x - Gy.x, p.z - Gy.z) < 1.4 && p.y < Gy.y + 1.2 && P.vy < Gy.launch * 0.6) {
          P.vy = Gy.launch; P.grounded = false; P.support = null;
          this.banner('geyser', '♨️', 'Los géiseres te lanzan hacia arriba: úsalos para llegar más alto');
        }
        if (Gy.T <= 0) { Gy.state = 'idle'; Gy.T = rnd(3.5, 6.5); Gy.hole.scale.setScalar(0.65); }
      }
    }
    // lava: quema al pisarla y empuja hacia fuera
    this.lavaHop = Math.max(0, this.lavaHop - dt);
    if (playing && !P.scripted) {
      const out = this.lavaAt(p);
      if (out) {
        g.hurtHero(HEALTH.lavaDps * dt, { dot: true });
        p.x += out.x * 7 * dt; p.z += out.z * 7 * dt;
        P.vx = out.x * 5; P.vz = out.z * 5;
        if (this.lavaHop <= 0) { this.lavaHop = 0.55; P.vy = Math.max(P.vy, 6.5); P.grounded = false; }
        if (Math.random() < dt * 20) fx.flame(p.x + rnd(-0.3, 0.3), p.y + 0.2, p.z + rnd(-0.3, 0.3), 0.9, 0.05);
        g.tip('lava');
        this.banner('lava', '🔥', '¡La lava quema! Usa los puentes, las balsas y las plataformas');
      }
    }
    // ambiente: llamas, fumarolas, cascadas de lava, cráter, ascuas
    this.fxAcc += dt;
    if (this.fxAcc > 0.05) {
      const k = this.fxAcc; this.fxAcc = 0;
      for (const [x, y, z, s] of this.cfg.flames || []) {
        const d = Math.hypot(cam.x - x, cam.z - z);
        if (d < 60 && Math.random() < k * 6 * s) fx.flame(x + rnd(-0.3, 0.3) * s, y, z + rnd(-0.3, 0.3) * s, s, 0.2);
      }
      for (const [x, y, z, col] of this.cfg.fumaroles || []) {
        const d = Math.hypot(cam.x - x, cam.z - z);
        if (d < 90 && Math.random() < k * 3) fx.smokePuff(x + rnd(-0.5, 0.5), y + 0.6, z + rnd(-0.5, 0.5), 2.4, col);
      }
      for (const f of this.cfg.falls || []) {
        const d = Math.hypot(cam.x - f.x, cam.z - f.z);
        if (d < 70 && Math.random() < k * 8) { fx.ember(f.x + rnd(-1.5, 1.5), f.y0 + 0.3, f.z + rnd(-0.8, 0.8), 1.2); if (Math.random() < 0.4) fx.smokePuff(f.x, f.y0 + 0.8, f.z, 1.6, 0x3a2a24); }
      }
      const C = this.cfg.crater;
      if (C) {
        if (Math.random() < k * 4) fx.smokePuff(C.x + rnd(-C.r, C.r) * 0.6, C.y + rnd(2, 6), C.z + rnd(-C.r, C.r) * 0.6, 5, rnd(0, 1) < 0.5 ? 0x3a3634 : 0x5a5250);
        if (Math.random() < k * 3) fx.flame(C.x + rnd(-3, 3), C.y + 1, C.z + rnd(-3, 3), 2.2, 0.4);
        if (Math.random() < k * 0.5) for (let i = 0; i < 8; i++) fx.ember(C.x + rnd(-2, 2), C.y + rnd(1, 8), C.z + rnd(-2, 2), 2);
      }
      if (Math.random() < k * 10) fx.ember(cam.x + rnd(-18, 18), cam.y + rnd(-4, 8), cam.z + rnd(-18, 18), 0.7);
    }
    // luces de la lava: las cuatro más cercanas a la cámara, con parpadeo de fuego
    this.lightAcc += dt;
    const L = this.cfg.lights || [];
    if (this.lightAcc > 0.5) {
      this.lightAcc = 0;
      const best = L.map((l) => [l, Math.hypot(cam.x - l[0], cam.z - l[2])]).sort((a, b) => a[1] - b[1]).slice(0, 4);
      this.lights.forEach((li, i) => { const e = best[i]; li.userData.def = e ? e[0] : null; if (e) { li.position.set(e[0][0], e[0][1], e[0][2]); li.color.setHex(e[0][3]); li.distance = e[0][5]; } });
    }
    for (const li of this.lights) { const d = li.userData.def; li.intensity = d ? d[4] * (0.85 + 0.15 * Math.sin(t * 7 + d[0]) + 0.08 * Math.sin(t * 17.3 + d[2])) : 0; }
    // luces del camión de bomberos
    this.beacons.forEach((b, i) => { b.visible = Math.sin(t * 9 + i * Math.PI) > 0; });
    // los soldados de Kerberos respiran y vigilan
    (this.cfg.guards || []).forEach((m, i) => {
      if (m.userData.s0 === undefined) { m.userData.s0 = m.scale.y; m.userData.ry0 = m.rotation.y; }
      m.scale.y = m.userData.s0 * (1 + 0.012 * Math.sin(t * 2 + i));
      m.rotation.y = m.userData.ry0 + 0.25 * Math.sin(t * 0.4 + i * 2);
    });
  }

  climb(R, to, dir) {
    const g = this.g, p = g.player.pos;
    R.armed = false;
    g.startRope({ x: to[0], y: to[1], z: to[2] });
    if (g.rope) g.rope.dur = Math.max(1.1, Math.hypot(to[0] - p.x, to[1] - p.y, to[2] - p.z) / 5.5);
    audio.sfx('flap');
    this.banner('rope' + dir, '🪢', dir === 'sube' ? `Cuerda: ${R.name}. Acércate a la marca para subir o bajar` : 'Pisa la marca del borde para bajar por la cuerda');
  }

  dispose() {
    const W = this.g.world;
    for (const pl of this.platforms) { const i = W.dynSolids.indexOf(pl.solid); if (i >= 0) W.dynSolids.splice(i, 1); }
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
