import * as THREE from 'three';
import { ELEMENTS } from '../heroes.js';

/* ======================================================================
   IMPACTO VISIBLE DE LOS PODERES Y LAS ARMAS SOBRE EL JEFE Y SUS SOLDADOS
   Todo el daño a enemigos pasa por Combat.damage(); desde ahí se llama a hit(), así que cualquier poder
   o arma que alcance al jefe o a un soldado muestra el contacto, sin tocar el daño ni el equilibrio:
   · Destello blanco en estrella justo en el punto de contacto (la cara del enemigo que mira al héroe)
     y una explosión de luz del color del elemento del héroe: el lanzamiento y el impacto se distinguen.
   · Onda de choque que se abre desde el punto de contacto, rayos de energía en abanico y chispas.
   · Reacción del cuerpo: el enemigo retrocede y se encoge un instante en la dirección del golpe ("punch").
   · El daño continuo (zonas, lava, tormentas...) deja pequeños destellos periódicos sobre el enemigo
     mientras le afecta, para que se vea que el poder le está haciendo daño.
   ====================================================================== */

const rnd = (a, b) => a + Math.random() * (b - a);
let TEX = null;
function textures() {
  if (TEX) return TEX;
  const mk = (draw) => { const c = document.createElement('canvas'); c.width = c.height = 128; draw(c.getContext('2d')); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  TEX = {
    // estrella de cuatro puntas con núcleo brillante
    star: mk((g) => {
      const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.85)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      g.globalCompositeOperation = 'lighter';
      for (const [w, h] of [[128, 9], [9, 128], [70, 5], [5, 70]]) {
        const l = g.createLinearGradient(64 - w / 2, 64 - h / 2, 64 + w / 2, 64 + h / 2);
        l.addColorStop(0, 'rgba(255,255,255,0)'); l.addColorStop(0.5, 'rgba(255,255,255,0.95)'); l.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = l;
        g.save(); g.translate(64, 64); if (w === 70) g.rotate(Math.PI / 4); g.fillRect(-w / 2, -h / 2, w, h); g.restore();
      }
    }),
    // halo suave
    glow: mk((g) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.4)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }),
    // anillo de onda de choque
    ring: mk((g) => { const gr = g.createRadialGradient(64, 64, 40, 64, 64, 63); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.75, 'rgba(255,255,255,0.4)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }),
    // rayo alargado (se gira en pantalla con la rotación del sprite)
    streak: mk((g) => { const gr = g.createLinearGradient(0, 64, 128, 64); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.3, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 58, 128, 12); }),
  };
  return TEX;
}

// Estallido de luz reutilizable (también lo usan las armas): estrella blanca, halo de color, onda y rayos
export function flashBurst(game, pos, { color = 0xffffff, color2 = 0xffffff, k = 1, streaks = 6, life = 1, glow = true } = {}) {
  const T = textures(), vfx = game.vfx;
  const sp = (tex, col, size, dur, upd, rot = 0) => {
    const mat = new THREE.SpriteMaterial({ map: tex, color: col, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, rotation: rot, toneMapped: false });
    const s = new THREE.Sprite(mat); s.userData.own = true; s.renderOrder = 40; s.position.copy(pos); s.scale.setScalar(size);
    vfx.add(s, dur, (it) => upd(s, mat, Math.min(1, it.t / dur)));
  };
  sp(T.star, 0xffffff, 1.1 * k, 0.15 * life, (s, m, kk) => { m.opacity = 0.85 * (1 - kk * kk); s.scale.setScalar(1.1 * k * (0.8 + 0.8 * kk)); m.rotation = 0.5 * kk; });
  if (glow) sp(T.glow, color, 2 * k, 0.24 * life, (s, m, kk) => { m.opacity = 0.55 * (1 - kk); s.scale.setScalar(2 * k * (0.5 + 0.8 * kk)); });
  sp(T.ring, color2, 0.3, 0.3 * life, (s, m, kk) => { m.opacity = 0.85 * (1 - kk); s.scale.setScalar(0.3 + 2.8 * k * (1 - (1 - kk) * (1 - kk))); });
  for (let i = 0; i < streaks; i++) {
    const rot = (i / streaks) * Math.PI * 2 + rnd(-0.3, 0.3), len = rnd(1.2, 2.2) * k;
    sp(T.streak, i % 2 ? 0xffffff : color, 0.4, 0.18 * life, (s, m, kk) => { m.opacity = 1 - kk; s.scale.set(len * (0.4 + kk), 0.3 * k * (1 - kk * 0.6), 1); }, rot);
  }
}
// Destello en estrella (brillo en el filo del arma)
export function glintSprite(color) {
  const mat = new THREE.SpriteMaterial({ map: textures().star, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0 });
  const s = new THREE.Sprite(mat); s.renderOrder = 41; s.frustumCulled = false; s.visible = false;
  return s;
}

export class ImpactFx {
  constructor(game) {
    this.g = game;
    this.t = 0;
  }
  update(dt) { this.t += dt; }

  sprite(tex, color, pos, size, life, upd, rot = 0) {
    const mat = new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, rotation: rot, toneMapped: false });
    const s = new THREE.Sprite(mat);
    s.userData.own = true;
    s.renderOrder = 40;
    s.position.copy(pos);
    s.scale.setScalar(size);
    return this.g.vfx.add(s, life, (it) => upd(s, mat, Math.min(1, it.t / life)));
  }

  color() {
    const h = this.g.hero;
    return h && ELEMENTS[h.element] ? ELEMENTS[h.element].color : 0xffe070;
  }

  // punto de contacto: superficie del enemigo que mira al héroe, a media altura de su cuerpo
  contact(t) {
    const p = this.g.player ? this.g.player.pos : t.pos;
    const h = t.heavy && t.S ? t.S.height * 0.55 + (t.flyHeight || 0) : (t.barH || 1.6) * 0.55;
    let dx = p.x - t.pos.x, dz = p.z - t.pos.z;
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const r = (t.radius || 0.6) * 0.75;
    return { pos: new THREE.Vector3(t.pos.x + dx * r, t.pos.y + h, t.pos.z + dz * r), dx: -dx, dz: -dz };
  }

  hit(t, n, quiet = false) {
    if (!t || t.prop || t.dead || !this.g.vfx) return;
    const now = this.t, fx = this.g.fx, col = this.color();
    if (quiet) {
      // daño continuo: un pequeño destello cada 0,35 s mientras dure
      if (now - (t._dotFx || -9) < 0.35) return;
      t._dotFx = now;
      const { pos } = this.contact(t);
      pos.x += rnd(-0.4, 0.4); pos.y += rnd(-0.3, 0.4); pos.z += rnd(-0.4, 0.4);
      const sz = t.heavy ? 1.4 : 0.8;
      this.sprite(textures().glow, col, pos, sz, 0.25, (s, m, k) => { m.opacity = 0.9 * (1 - k); s.scale.setScalar(sz * (0.7 + 0.6 * k)); });
      for (let i = 0; i < 4; i++) fx.sparkle(pos.x, pos.y, pos.z, col, 1.8);
      t.punch = Math.max(t.punch || 0, 0.25);
      return;
    }
    // golpes seguidos del mismo enemigo (varios impactos por fotograma): un solo estallido cada 70 ms
    if (now - (t._hitFx || -9) < 0.07) return;
    t._hitFx = now;
    const T = textures();
    const big = !!t.heavy;
    const k = Math.min(1.5, Math.max(0.7, n / (big ? 10 : 8))) * (big ? 1.1 : 0.7);
    const { pos, dx, dz } = this.contact(t);
    // varios enemigos alcanzados a la vez: los destellos grandes no se acumulan (no deslumbran)
    this.recent = (this.recent || []).filter((r) => now - r < 0.06);
    const crowd = this.recent.length;
    this.recent.push(now);
    // 1 · destello blanco en estrella (el instante del contacto)
    const s1 = 0.9 * k * (crowd ? 0.7 : 1);
    this.sprite(T.star, 0xffffff, pos, s1, 0.16, (s, m, kk) => { m.opacity = 0.9 * (1 - kk * kk); s.scale.setScalar(s1 * (0.8 + 0.7 * kk)); m.rotation = kk * 0.6; });
    // 2 · explosión de luz del color del elemento
    const s2 = 1.6 * k;
    if (!crowd) this.sprite(T.glow, col, pos, s2, 0.26, (s, m, kk) => { m.opacity = 0.45 * (1 - kk); s.scale.setScalar(s2 * (0.5 + 0.8 * kk)); });
    // 3 · onda de choque que se abre
    const s3 = 2.6 * k;
    this.sprite(T.ring, col, pos, 0.3, 0.32, (s, m, kk) => { m.opacity = 0.9 * (1 - kk); s.scale.setScalar(0.3 + s3 * (1 - (1 - kk) * (1 - kk))); });
    // 4 · rayos de energía en abanico
    const nStreak = big ? 7 : 5;
    for (let i = 0; i < nStreak; i++) {
      const rot = (i / nStreak) * Math.PI * 2 + rnd(-0.3, 0.3), len = rnd(1.1, 1.9) * k;
      this.sprite(T.streak, i % 2 ? 0xffffff : col, pos, 0.4, 0.2, (s, m, kk) => { m.opacity = 1 - kk; s.scale.set(len * (0.4 + kk), 0.35 * k * (1 - kk * 0.6), 1); }, rot);
    }
    // 5 · chispas y esquirlas de energía que salen despedidas en la dirección del golpe
    const nSp = Math.round(10 * k);
    for (let i = 0; i < nSp; i++) fx.sparkle(pos.x + dx * 0.2, pos.y + rnd(-0.2, 0.2), pos.z + dz * 0.2, i % 3 ? col : 0xffffff, 3.4);
    if (this.g.vfx.ring) this.g.vfx.ring(t.pos.x, null, t.pos.z, { r0: (t.radius || 0.6) * 0.8, r1: (t.radius || 0.6) * (big ? 2.4 : 2), dur: 0.3, color: col, opacity: 0.6 });
    // 6 · reacción del cuerpo: retrocede y se encoge en la dirección del golpe
    t.punch = 1; t.punchDx = dx; t.punchDz = dz;
  }
}
