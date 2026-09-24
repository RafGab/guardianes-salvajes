import * as THREE from 'three';
import { clamp } from './utils.js';
import { Audio3D as audio } from './audio.js';
import { ui } from './ui.js';

// Herramientas de rescate. `G` es la instancia de Game (player, world, fx, ui, audio, chase, victims, hazards...)
export function useTool(id, G) {
  switch (id) {
    case 'axe': return axe(G);
    case 'rope': return rope(G);
    case 'flashlight': return flashlight(G);
    case 'shield': return shield(G);
    case 'wind': return wind(G);
    case 'goggles': return goggles(G);
    case 'piolet': return piolet(G);
    case 'canteen': return canteen(G);
    default: return false;
  }
}

/* ---------------- 🪓 Hacha ---------------- */
function axe(G) {
  const { player: p, world, fx, chase } = G;
  const fx_ = Math.sin(p.facing), fz_ = Math.cos(p.facing);
  p.powerAnim = 1;
  p.swingT = 0.45;
  let hit = 0;
  for (const o of [...world.obstacles]) {
    if (!o.alive || o.breakBy !== 'axe') continue;
    const dx = o.x - p.pos.x, dz = o.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 4.4 || Math.abs(o.y - p.pos.y) > 3) continue;
    if (d > 1.8 && (dx * fx_ + dz * fz_) / d < 0.1) continue;
    world.breakObstacle(o);
    hit++;
  }
  audio.noiseBurst(0.18, 700, 0.5, 'bandpass');
  if (!hit) {
    ui.banner('find', '🪓', 'No hay nada que cortar aquí');
    return false;
  }
  chase.shake(0.14);
  G.addScore(15 * hit);
  G.addEco(3 * hit);
  ui.banner('good', '🪓 ¡Camino abierto!', `+${15 * hit} puntos`);
  return true;
}

/* ---------------- 🪢 Cuerda ---------------- */
function rope(G) {
  const { player: p, world } = G;
  // 1) bajar a alguien que está en un lugar alto
  let vt = null, bd = 1e9;
  for (const v of G.victims) {
    if (v.state !== 'waiting' || v.hidden || v.thirsty) continue;
    if (v.blockers && v.blockers.some((o) => o.alive)) continue;
    const dx = v.wpos.x - p.pos.x, dz = v.wpos.z - p.pos.z;
    const d = Math.hypot(dx, dz), dy = v.wpos.y - p.pos.y;
    if (d < 13 && dy > 2.2 && dy < 12 && d < bd) { bd = d; vt = v; }
  }
  if (vt && p.carrying.length < p.capacity) {
    G.ropeLineTo(vt.wpos, 0.8);
    G.pickup(vt);
    audio.whoosh();
    ui.banner('good', '🪢 ¡Bajado con la cuerda!', `${vt.info.label} está a salvo contigo`);
    return true;
  }
  // 2) gancho a un saliente elevado
  const fx_ = Math.sin(p.facing), fz_ = Math.cos(p.facing);
  const near = world.solidsNear(p.pos.x - 16, p.pos.x + 16, p.pos.z - 16, p.pos.z + 16, []);
  let best = null, bs = 1e9;
  for (const s of near) {
    if (s.tag === 'tree' || s.tag === 'rail' || s.tag === 'fence' || s.tag === 'obstacle') continue;
    const rise = s.y1 - p.pos.y;
    if (rise < 2.6 || rise > 13) continue;
    if (s.x1 - s.x0 < 1.6 || s.z1 - s.z0 < 1.6) continue;
    const cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2;
    const dx = cx - p.pos.x, dz = cz - p.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 16 || dist < 0.6) continue;
    const dot = (dx * fx_ + dz * fz_) / dist;
    if (dot < 0.25) continue;
    const sc = dist + Math.abs(rise - 6) * 0.3 - dot * 4;
    if (sc < bs) { bs = sc; best = s; }
  }
  if (!best) {
    ui.banner('find', '🪢', 'No hay ningún saliente al que enganchar delante');
    return false;
  }
  const tx = clamp(p.pos.x, best.x0 + 0.9, best.x1 - 0.9), tz = clamp(p.pos.z, best.z0 + 0.9, best.z1 - 0.9);
  G.startRope({ x: tx, y: best.y1 + 0.05, z: tz });
  audio.whoosh();
  return true;
}

/* ---------------- 🔦 Linterna ---------------- */
function flashlight(G) {
  G.player.torchT = 8;
  ui.banner('find', '🔦 Linterna encendida', 'Ilumina delante para descubrir a quien esté oculto');
  audio.tone(900, 0.08, 'square', 0.08);
  return true;
}

/* ---------------- 🛡️ Escudo ---------------- */
function shield(G) {
  G.player.shieldT = 7;
  G.fx.sparkle(G.player.pos.x, G.player.pos.y + 1, G.player.pos.z, 0x7ad8ff, 3);
  for (let i = 0; i < 18; i++) G.fx.sparkle(G.player.pos.x, G.player.pos.y + 1, G.player.pos.z, 0x7ad8ff, 3);
  audio.power('surf');
  ui.banner('good', '🛡️ ¡Escudo activo!', 'Inmune a calor, lava, escombros y ráfagas durante unos segundos');
  return true;
}

/* ---------------- 🌀 Viento ---------------- */
function wind(G) {
  const { player: p, world, fx, chase } = G;
  const fx_ = Math.sin(p.facing), fz_ = Math.cos(p.facing);
  p.powerAnim = 1;
  let n = 0;
  for (const o of [...world.obstacles]) {
    if (!o.alive || o.breakBy !== 'wind') continue;
    const dx = o.x - p.pos.x, dz = o.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 10 || Math.abs(o.y - p.pos.y) > 3) continue;
    if (d > 2 && (dx * fx_ + dz * fz_) / d < 0.35) continue;
    world.breakObstacle(o);
    n++;
  }
  if (G.hazards && G.hazards.gust) G.hazards.gust(p.pos, fx_, fz_);
  for (let i = 0; i < 46; i++) {
    const t = Math.random() * 10;
    const sx = p.pos.x + fx_ * t + (Math.random() - 0.5) * (1 + t * 0.35), sz = p.pos.z + fz_ * t + (Math.random() - 0.5) * (1 + t * 0.35);
    fx.mist(sx, p.pos.y + 0.8 + Math.random() * 1.6, sz, 0xeaf6ff, 1.4);
    if (i % 3 === 0) fx.sparkle(sx, p.pos.y + 1, sz, 0xdff2ff, 2);
  }
  audio.whoosh();
  chase.shake(0.16);
  if (n) {
    G.addScore(20 * n);
    G.addEco(4 * n);
    ui.banner('good', '🌀 ¡Ráfaga!', `${n} ${n > 1 ? 'obstáculos despejados' : 'obstáculo despejado'} · +${20 * n}`);
  } else ui.banner('find', '🌀', 'La ráfaga despeja el aire');
  return true;
}

/* ---------------- 🥽 Gafas de tormenta ---------------- */
function goggles(G) {
  G.goggleT = 10;
  G.world.fogMul = 0.35;
  G.pingT = Math.max(G.pingT, 8);
  ui.banner('good', '🥽 ¡Gafas de tormenta!', 'La niebla se aparta y se marcan los rescates');
  audio.found();
  return true;
}

/* ---------------- ⛏️ Piolet ---------------- */
function piolet(G) {
  G.player.climbT = 9;
  ui.banner('good', '⛏️ ¡Piolet listo!', 'Trepa paredes altas y no resbalas durante unos segundos');
  audio.tone(500, 0.12, 'triangle', 0.1);
  return true;
}

/* ---------------- 💧 Cantimplora ---------------- */
function canteen(G) {
  const { player: p, fx } = G;
  let n = 0;
  for (const v of G.victims) {
    if (!v.thirsty || v.state !== 'waiting') continue;
    if (p.pos.distanceTo(v.wpos) > 7) continue;
    v.thirsty = false;
    n++;
    for (let i = 0; i < 14; i++) fx.spray(v.wpos.x, v.wpos.y + 1, v.wpos.z, 0, 2, 0, 1.2);
  }
  if (G.hazards && G.hazards.cool) G.hazards.cool(0.5);
  for (let i = 0; i < 12; i++) fx.spray(p.pos.x, p.pos.y + 1.6, p.pos.z, 0, 1.5, 0, 1);
  audio.splash();
  if (n) {
    G.addScore(25 * n);
    G.addEco(10 * n);
    ui.banner('good', '💧 ¡Ha bebido!', `${n} ${n > 1 ? 'sedientos' : 'sediento'} ya pueden moverse · +${25 * n}`);
  } else ui.banner('good', '💧', 'Te refrescas un poco');
  return true;
}
