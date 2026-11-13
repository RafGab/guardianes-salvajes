import * as THREE from 'three';
import { ui } from '../ui.js';
import { Audio3D as audio } from '../audio.js';
import { SEE, enableSeeThrough } from '../seethrough.js';

/* ======================================================================
   CAMP FIRE · elementos vivos del nivel
   · Piñas doradas (coleccionables) y medallas de los lugares secretos
   · Descubrimiento de lugares secretos (cueva tras la cascada, casa del árbol, túnel)
   · Troncos flotantes que van y vienen por el río: plataformas móviles sobre las que se viaja
   · Cascada y arroyo animados, luz propia de las cuevas y escenario transparente dentro de ellas
   ====================================================================== */
const TAU = Math.PI * 2;

let GEO = null;
function geos() {
  if (GEO) return GEO;
  const cone = new THREE.SphereGeometry(0.24, 10, 8); cone.scale(1, 1.45, 1);
  GEO = {
    cone,
    scale: new THREE.ConeGeometry(0.1, 0.14, 5),
    leaf: new THREE.ConeGeometry(0.09, 0.26, 5),
    halo: new THREE.PlaneGeometry(1.4, 1.4),
    disc: new THREE.CylinderGeometry(0.42, 0.42, 0.1, 28),
    ring: new THREE.TorusGeometry(0.46, 0.06, 8, 32),
    star: (() => {
      const s = new THREE.Shape();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.13 : 0.3, a = (i / 10) * TAU + Math.PI / 2; i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
      return new THREE.ExtrudeGeometry(s, { depth: 0.06, bevelEnabled: false });
    })(),
    log: new THREE.CylinderGeometry(0.55, 0.55, 3.2, 12),
    logEnd: new THREE.CircleGeometry(0.5, 12),
  };
  GEO.log.rotateZ(Math.PI / 2);
  return GEO;
}
let HALO_TEX = null;
function haloTex() {
  if (HALO_TEX) return HALO_TEX;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,230,140,0.9)'); gr.addColorStop(0.4, 'rgba(255,190,60,0.35)'); gr.addColorStop(1, 'rgba(255,170,40,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  HALO_TEX = new THREE.CanvasTexture(c);
  return HALO_TEX;
}

const WATER_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const FALL_FS = `uniform float uT; uniform float uFlow; varying vec2 vUv;
float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
void main(){
  vec2 p = vec2(vUv.x * 9.0, vUv.y * 4.0 + uT * uFlow);
  float s = n(p) * 0.6 + n(p * 2.3 + 7.0) * 0.4;
  float streak = smoothstep(0.45, 0.85, s);
  vec3 col = mix(vec3(0.35, 0.72, 0.9), vec3(0.95, 0.99, 1.0), streak);
  float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
  float foam = smoothstep(0.22, 0.0, vUv.y);
  col = mix(col, vec3(1.0), foam * 0.8);
  gl_FragColor = vec4(col, (0.62 + 0.3 * streak + foam * 0.3) * edge);
}`;

export class CampFireRuntime {
  constructor(game, cfg) {
    this.g = game;
    this.cfg = cfg;
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.items = [];
    this.found = new Set();
    this.got = 0;
    this.medals = 0;
    this.totalCones = cfg.collectibles.filter((c) => c.kind === 'cone').length;
    this.totalMedals = cfg.collectibles.filter((c) => c.kind === 'medal').length;
    this.t = 0;
    this.buildCollectibles();
    this.buildLogs();
    this.buildWater();
    this.buildCaves();
    enableSeeThrough(game.world.mats);
    this.hud();
  }

  /* ---------- coleccionables ---------- */
  buildCollectibles() {
    const G = geos();
    const gold = new THREE.MeshStandardMaterial({ color: 0xffc23a, emissive: 0xff9a10, emissiveIntensity: 0.3, metalness: 0.6, roughness: 0.3 });
    const goldD = new THREE.MeshStandardMaterial({ color: 0xd8901a, emissive: 0xa85a00, emissiveIntensity: 0.4, metalness: 0.6, roughness: 0.35 });
    const green = new THREE.MeshStandardMaterial({ color: 0x4ac05a, emissive: 0x1a6a2a, emissiveIntensity: 0.4 });
    const haloM = new THREE.MeshBasicMaterial({ map: haloTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.45 });
    const medalM = new THREE.MeshStandardMaterial({ color: 0x7ae0ff, emissive: 0x2aa0ff, emissiveIntensity: 0.9, metalness: 0.5, roughness: 0.25 });
    for (const c of this.cfg.collectibles) {
      const root = new THREE.Group();
      root.position.set(c.x, c.y, c.z);
      const body = new THREE.Group();
      root.add(body);
      if (c.kind === 'cone') {
        body.add(new THREE.Mesh(G.cone, gold));
        // escamas de la piña
        for (let r = 0; r < 4; r++) for (let k = 0; k < 5; k++) {
          const a = (k / 5) * TAU + r * 0.6, y = -0.22 + r * 0.15, rad = 0.2 * Math.sin(Math.PI * (0.25 + r * 0.17));
          const sc = new THREE.Mesh(G.scale, goldD);
          sc.position.set(Math.cos(a) * rad, y, Math.sin(a) * rad);
          sc.lookAt(sc.position.x * 3, y - 0.3, sc.position.z * 3);
          body.add(sc);
        }
        for (const a of [0, 2.1, 4.2]) { const l = new THREE.Mesh(G.leaf, green); l.position.set(Math.cos(a) * 0.05, 0.38, Math.sin(a) * 0.05); l.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5); body.add(l); }
      } else {
        const d = new THREE.Mesh(G.disc, medalM); d.rotation.x = Math.PI / 2; body.add(d);
        body.add(new THREE.Mesh(G.ring, gold));
        for (const s of [1, -1]) { const st = new THREE.Mesh(G.star, gold); st.position.z = s * 0.05 - (s < 0 ? 0.06 : 0); body.add(st); }
        body.scale.setScalar(1.25);
      }
      const halo = new THREE.Mesh(G.halo, haloM);
      halo.scale.setScalar(c.kind === 'medal' ? 2 : 0.8);
      root.add(halo);
      this.group.add(root);
      this.items.push({ ...c, root, body, halo, taken: false, ph: Math.random() * TAU, pop: 0 });
    }
  }

  /* ---------- troncos flotantes ---------- */
  buildLogs() {
    const G = geos();
    const W = this.g.world;
    const bark = new THREE.MeshStandardMaterial({ color: 0x7a5030, roughness: 0.9 });
    const ring = new THREE.MeshStandardMaterial({ color: 0xd8b078, roughness: 0.8 });
    this.logs = this.cfg.logs.map((L) => {
      const m = new THREE.Group();
      const body = new THREE.Mesh(G.log, bark); body.castShadow = true; m.add(body);
      for (const s of [1, -1]) { const e = new THREE.Mesh(G.logEnd, ring); e.position.x = s * 1.61; e.rotation.y = s * Math.PI / 2; m.add(e); }
      this.group.add(m);
      const top = L.y + 0.5;
      const solid = { x0: L.x - 1.6, x1: L.x + 1.6, y0: top - 1.0, y1: top, z0: L.z - 0.55, z1: L.z + 0.55, tag: 'log', dyn: true, dx: 0, dy: 0, dz: 0, _q: 0 };
      W.dynSolids.push(solid);
      return { ...L, m, solid, cx: L.x, top };
    });
  }

  /* ---------- cascada y arroyo ---------- */
  buildWater() {
    const wf = this.cfg.waterfall, st = this.cfg.stream;
    this.fallU = { uT: { value: 0 }, uFlow: { value: -2.2 } };
    const fall = new THREE.Mesh(new THREE.PlaneGeometry(wf.z1 - wf.z0, wf.y1 - wf.y0), new THREE.ShaderMaterial({ uniforms: this.fallU, vertexShader: WATER_VS, fragmentShader: FALL_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    fall.rotation.y = Math.PI / 2;
    fall.position.set(wf.x, (wf.y0 + wf.y1) / 2, (wf.z0 + wf.z1) / 2);
    fall.renderOrder = 4;
    this.group.add(fall);
    // segunda cortina algo separada para dar volumen
    const fall2 = fall.clone(); fall2.material = fall.material.clone(); fall2.material.uniforms = { uT: this.fallU.uT, uFlow: { value: -2.8 } };
    fall2.position.x += 0.5; fall2.scale.set(0.92, 1, 1);
    this.group.add(fall2);
    this.streamU = { uT: this.fallU.uT, uFlow: { value: -0.9 } };
    const stream = new THREE.Mesh(new THREE.PlaneGeometry(st.w, st.x1 - st.x0), new THREE.ShaderMaterial({ uniforms: this.streamU, vertexShader: WATER_VS, fragmentShader: FALL_FS, transparent: true, depthWrite: false }));
    stream.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
    stream.position.set((st.x0 + st.x1) / 2, st.y, st.z);
    this.group.add(stream);
    this.mistAcc = 0;
  }

  buildCaves() {
    this.caveLights = this.cfg.caves.map((c) => {
      const [x, y, z, col] = c.light;
      const l = new THREE.PointLight(col, 2.2, 16, 1.4);
      l.position.set(x, y, z);
      this.group.add(l);
      return l;
    });
  }

  /* ---------- HUD ---------- */
  hud() {
    let el = document.getElementById('cf-hud');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cf-hud';
      el.className = 'panel cf-hud';
      (document.getElementById('hud') || document.body).appendChild(el);
    }
    el.style.display = '';
    this.el = el;
    this.refresh();
  }
  refresh() {
    if (this.el) this.el.innerHTML = `<span title="Piñas doradas">🌰 <b>${this.got}</b>/${this.totalCones}</span><span title="Lugares secretos">🗝️ <b>${this.found.size}</b>/${this.cfg.secrets.length}</span>`;
  }

  /* ---------- actualización ---------- */
  update(dt, playing) {
    const g = this.g, p = g.player.pos;
    this.t += dt;
    const t = this.t;
    // piñas y medallas: giran, flotan y se recogen al tocarlas
    for (const it of this.items) {
      if (it.taken) {
        if (it.pop > 0) {
          it.pop -= dt;
          const k = 1 - it.pop / 0.35;
          it.root.position.y = it.y + k * 1.4;
          it.root.scale.setScalar(Math.max(0.01, 1 + k * 0.6 - k * k * 1.5));
          if (it.pop <= 0) it.root.visible = false;
        }
        continue;
      }
      it.body.rotation.y += dt * (it.kind === 'medal' ? 1.6 : 2.4);
      it.root.position.y = it.y + Math.sin(t * 2.2 + it.ph) * 0.12;
      it.halo.quaternion.copy(g.camera.quaternion);
      if (!playing) continue;
      const dx = p.x - it.x, dz = p.z - it.z, dy = p.y + 0.9 - it.y;
      if (dx * dx + dz * dz < (it.kind === 'medal' ? 2.2 : 1.5) && Math.abs(dy) < 1.7) this.collect(it);
    }
    // troncos flotantes
    for (const L of this.logs) {
      const nx = L.cx + Math.sin(t * L.sp + L.ph) * L.amp;
      const bob = Math.sin(t * 1.7 + L.ph) * 0.05;
      const s = L.solid;
      s.dx = nx - L.x; s.dy = 0; s.dz = 0;
      L.x = nx;
      s.x0 = nx - 1.6; s.x1 = nx + 1.6;
      L.m.position.set(nx, L.top - 0.5 + bob, L.z);
      L.m.rotation.x = Math.sin(t * 1.3 + L.ph) * 0.06; // se balancea sobre el agua
      if (Math.abs(p.x - nx) < 3 && Math.abs(p.z - L.z) < 2 && Math.random() < dt * 3) g.fx.splash(nx + Math.sign(s.dx) * 1.6, g.world.waterY, L.z, 3, 0.4);
    }
    // cascada: agua que cae y bruma en la poza
    this.fallU.uT.value = t;
    const wf = this.cfg.waterfall;
    this.mistAcc += dt;
    if (this.mistAcc > 0.12 && Math.hypot(p.x - wf.x, p.z - (wf.z0 + wf.z1) / 2) < 70) {
      this.mistAcc = 0;
      const z = wf.z0 + Math.random() * (wf.z1 - wf.z0);
      g.fx.mist(wf.x + 0.6 + Math.random() * 2, g.world.waterY + 0.3, z, 0xeaf8ff, 2.2);
      if (Math.random() < 0.5) g.fx.spray(wf.x + 0.8, g.world.waterY + 0.2, z, 1.5 + Math.random() * 2, 2.5, (Math.random() - 0.5) * 2, 0.8);
    }
    // lugares secretos
    if (playing) {
      for (const s of this.cfg.secrets) {
        if (this.found.has(s.id)) continue;
        if (p.x > s.x0 && p.x < s.x1 && p.z > s.z0 && p.z < s.z1 && p.y > s.y0 && p.y < s.y1) {
          this.found.add(s.id);
          ui.banner('good', '🗝️ ¡Lugar secreto descubierto!', `${s.name} · +150 puntos`);
          g.addScore(150);
          audio.found();
          g.fx.confetti(p.x, p.y + 1.8, p.z);
          this.refresh();
        }
      }
    }
    // dentro de una cueva: luz cercana y el techo se vuelve transparente si tapa al héroe
    let inCave = null;
    for (const c of this.cfg.caves) if (p.x > c.x0 && p.x < c.x1 && p.z > c.z0 && p.z < c.z1 && p.y < c.y1) inCave = c;
    if (inCave) {
      SEE.uSeeOn.value = 1;
      SEE.uSeeCam.value.copy(g.camera.position);
      SEE.uSeeA.value.set(p.x, p.y + 1.0, p.z);
      SEE.uSeeB.value.set(p.x, p.y + 1.6, p.z);
      this.seeOn = true;
    } else if (this.seeOn && !g.boss) {
      SEE.uSeeOn.value = 0;
      this.seeOn = false;
    }
  }

  collect(it) {
    const g = this.g;
    it.taken = true;
    it.pop = 0.35;
    const { x, y, z } = it;
    for (let i = 0; i < 8; i++) g.fx.sparkle(x, y, z, it.kind === 'medal' ? 0x7ae0ff : 0xffd040, 3);
    if (it.kind === 'medal') {
      this.medals++;
      g.addScore(250);
      g.fx.confetti(x, y + 0.5, z);
      ui.banner('good', '🏅 ¡Medalla secreta!', `${this.medals}/${this.totalMedals} · +250 puntos`);
      audio.success();
    } else {
      this.got++;
      g.addScore(10);
      audio.tone(880 + (this.got % 5) * 90, 0.09, 'triangle', 0.07, 1320);
      if (this.got === this.totalCones) {
        g.addScore(500);
        ui.banner('good', '🌰 ¡Todas las piñas doradas!', '+500 puntos de bonus');
        audio.success();
      } else if (this.got % 10 === 0) ui.alert(`🌰 ${this.got} piñas doradas`, 1800);
    }
    this.refresh();
  }

  dispose() {
    const W = this.g.world;
    for (const L of this.logs) { const i = W.dynSolids.indexOf(L.solid); if (i >= 0) W.dynSolids.splice(i, 1); }
    if (this.group.parent) this.group.parent.remove(this.group);
    if (this.seeOn && !this.g.boss) SEE.uSeeOn.value = 0;
    if (this.el) this.el.style.display = 'none';
  }
}
