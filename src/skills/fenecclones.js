import * as THREE from 'three';
import { terrainH, CFG } from '../terrain.js';
import { ui } from '../ui.js';
import { Audio3D as audio } from '../audio.js';
import { BUTTON_TIMES } from './config.js';

/* ======================================================================
   CLONES ESPECIALIZADOS DE BADA (escudo de Espejismos)
   El escudo crea tres clones alrededor de Bada (ella sigue siendo morada):
     🔵 AZUL · PODER       → copia el próximo poder que lance Bada (mismo poder real, a su lado, a la vez)
     🔴 ROJO · RASTREADOR  → sale solo a buscar a una víctima, la recoge con la burbuja de rescate, la lleva al
                             refugio y la entrega (cuenta como un rescate más)
     🟡 AMARILLO · ESCUDO  → duplica la duración del escudo de Bada (una sola vez)
   Los tres son de UN SOLO USO: desaparecen justo cuando su especialidad se ha completado (poder ejecutado, víctima
   entregada y registrada, duración ampliada). Su desaparición no anula lo que ya han hecho.

   SELECCIÓN (con los controles que ya existen):
     · 1.ª pulsación de ESCUDO → aparecen los clones.
     · 2.ª pulsación → se abre la selección: el clon elegido se resalta (aro de su color, cartel con su
       especialidad, más brillo) y los demás se atenúan.
     · Tab, rueda del ratón o LB (mando) → siguiente opción: azul → rojo → amarillo → ✖ cancelar.
       (El movimiento sigue libre: WASD / stick no cambian la selección, así no hay conflictos.)
     · 3.ª pulsación de ESCUDO → confirma la opción resaltada (sobre «Cancelar» la cierra sin gastar ningún clon).
     · Sin tocar nada durante unos segundos, la selección se cierra sola. Nunca crea clones nuevos ni reinicia el
       tiempo del escudo; se puede abrir otra vez para elegir otro clon de los que queden.
   ====================================================================== */
export const CLONE_ROLES = [
  { id: 'power', label: 'PODER', name: 'azul', icon: '🔵', color: 0x2f7bff, trail: 0x9cc4ff },
  { id: 'rescue', label: 'RASTREADOR', name: 'rojo', icon: '🔴', color: 0xff2e2e, trail: 0xff9c9c },
  { id: 'shield', label: 'ESCUDO', name: 'amarillo', icon: '🟡', color: 0xffcc1a, trail: 0xfff0a0 },
];
const SEL_IDLE = 9;       // segundos sin tocar nada → la selección se cierra sola
const SEL_GUARD = 0.25;   // margen tras abrir la selección (una doble pulsación rápida no confirma por accidente)

const _v = new THREE.Vector3();
const angD = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/* ---------------- SELECCIÓN ---------------- */
export function selectOptions(sk) { return [...sk.ward.alive, 'cancel']; }
export function openSelect(sk) {
  sk.selecting = true; sk.selIdx = 0; sk.selT = 0; sk.selIdle = 0;
  showSel(sk, true);
  audio.sfx && audio.sfx('shimmer');
}
export function cycleSelect(sk, dir = 1) {
  if (!sk.selecting) return false;
  const opts = selectOptions(sk), n = opts.length;
  sk.selIdx = ((sk.selIdx + (dir < 0 ? -1 : 1)) % n + n) % n;
  sk.selIdle = 0;
  showSel(sk, false);
  audio.click && audio.click();
  return true;
}
function showSel(sk, first) {
  const opts = selectOptions(sk), o = opts[Math.min(sk.selIdx, opts.length - 1)];
  sk.ward.sel = o;
  const what = o === 'cancel' ? '✖ Cancelar' : `${o.role.icon} Clon ${o.role.name} · ${o.role.label}`;
  ui.banner('find', first ? '🪞 Elige un clon' : what, first ? `${what} · Tab / rueda / LB: cambiar · ESCUDO: confirmar` : 'ESCUDO: confirmar · Tab / rueda / LB: cambiar');
}
export function closeSelect(sk) { sk.selecting = false; if (sk.ward) sk.ward.sel = null; }
// la opción resaltada sigue siendo válida (un golpe puede haber roto ese clon)
export function tickSelect(sk, dt) {
  if (!sk.selecting) return;
  sk.selT += dt; sk.selIdle += dt;
  const opts = selectOptions(sk);
  if (opts.length <= 1) { closeSelect(sk); return; }
  if (sk.ward.sel !== opts[Math.min(sk.selIdx, opts.length - 1)]) { sk.selIdx = Math.min(sk.selIdx, opts.length - 1); showSel(sk, false); }
  if (sk.selIdle > SEL_IDLE) { closeSelect(sk); ui.banner('find', '🪞', 'Selección de clon cerrada'); }
}
export function confirmSelect(sk) {
  if (sk.selT < SEL_GUARD) return true; // demasiado rápido: no confirma nada por accidente
  const opts = selectOptions(sk), o = opts[Math.min(sk.selIdx, opts.length - 1)];
  closeSelect(sk);
  if (o === 'cancel' || !o) { ui.banner('find', '🪞', 'Selección cancelada · los clones siguen protegiéndote'); return true; }
  return startJob(sk, o);
}

/* ---------------- ESPECIALIDADES ---------------- */
function startJob(sk, m) {
  m.job = m.role.id; m.st = 0; m.jobStarted = false;
  m.face = sk.p.facing;
  if (m.job === 'shield') return doubleShield(sk, m);
  if (m.job === 'power') {
    m.jobT = 0; m.wait = sk.def.powerWait || 18;
    ui.banner('find', '🔵 Clon azul listo', 'Copiará el próximo poder que lances (a tu lado, a la vez)');
    return true;
  }
  if (m.job === 'rescue') {
    m.res = { st: 'search', t: 0, idle: 0, target: null, stuck: 0, pingT: 0, total: 0 };
    m.owner = { pos: new THREE.Vector3(m.x, m.y, m.z), facing: m.face };
    makeRunner(sk, m);
    ui.banner('find', '🔴 Clon rastreador en marcha', 'Busca a alguien, lo rescata y lo lleva al refugio');
    return true;
  }
  return false;
}

// 🟡 AMARILLO: duplica la duración del escudo existente (UNA vez) y desaparece al aplicarlo
function doubleShield(sk, m) {
  const g = sk.g, p = sk.p;
  if (sk.doubled) { m.job = null; return false; }
  const ab = g.abilities && g.abilities.find((a) => a.hs && a.key === sk.key);
  const T = BUTTON_TIMES.escudo, extra = T ? T.act : sk.def.life;
  sk.doubled = true;
  p.shieldT = (p.shieldT || 0) + extra;
  if (sk.def.ownShield) p.shieldOwnT = (p.shieldOwnT || 0) + extra;
  if (ab) {
    g.actT[ab.id] = (g.actT[ab.id] || 0) + extra;
    g.actMax[ab.id] = (g.actMax[ab.id] || extra) + extra;
    g.toolCd[ab.id] = (g.toolCd[ab.id] || 0) + extra; // la recarga empieza cuando acaba el escudo ampliado
  }
  const st = sk.stages && sk.stages.find((s) => s.name === 'espejismos');
  if (st) st.dur += extra; // los espejismos también duran el doble
  const q = p.pos;
  sk.vfx.ring(q.x, null, q.z, { r0: 0.4, r1: sk.def.radius + 1.6, dur: 0.6, color: 0xffcc1a });
  if (sk.v2) sk.v2.shell(new THREE.Vector3(q.x, q.y + p.H * 0.5, q.z), { r: sk.def.radius, color: 0xffcc1a, rim: 0xffffff, opacity: 0.55, life: 0.4 });
  sk.vfx.bolt && sk.vfx.bolt(new THREE.Vector3(m.x, m.y + p.H * 0.6, m.z), new THREE.Vector3(q.x, q.y + p.H * 0.6, q.z), { color: 0xffe070, life: 0.25, jag: 0.2, segs: 8 });
  const base = T ? T.act : extra;
  ui.banner('good', '🟡 ¡Escudo duplicado!', `${base} s → ${base + extra} s`);
  audio.sfx && audio.sfx('chime');
  m.glow = 0.6;
  sk.ward.vanish(m); // efecto aplicado → el clon amarillo desaparece (el escudo ampliado se mantiene)
  return true;
}

// 🔵 AZUL: Bada acaba de lanzar un poder (HeroSkills.use) → el clon lanza ESE MISMO poder (clase real) a su lado
export function copyPower(sk, key, def, Cls, role) {
  const m = sk.ward && sk.ward.mirrors.find((q) => q.alive && q.job === 'power' && !q.copy && q.state !== 'vanish');
  if (!m || Cls.background || key === sk.key || !(role === 'poder' || role === 'especial')) return;
  sideSpot(sk, m, true);
  const ghost = ghostOf(sk, m);
  const c = new Cls(sk.hs, def);
  c.p = ghost; c.pose = ghost.pose; c.key = 'clon:' + key; c.role = role;
  let ok = false;
  try { ok = c.begin(); } catch (e) { console.warn('clon azul:', e); }
  if (!ok) { c.dispose(); return; }
  m.copy = c; m.ghost = ghost;
  ui.banner('good', '🔵 ¡Ataque doble!', `El clon azul lanza ${def.name} contigo`);
}
// el clon azul se coloca a la derecha de Bada, mirando hacia donde mira ella (se ven bien los dos)
function sideSpot(sk, m, snap) {
  const p = sk.p, f = p.facing, rx = -Math.cos(f), rz = Math.sin(f), d = 1.9;
  const tx = p.pos.x + rx * d, tz = p.pos.z + rz * d;
  const k = snap ? 1 : 0.18;
  m.x += (tx - m.x) * k; m.z += (tz - m.z) * k;
  m.y = p.floorY ? p.floorY(m.x, m.z, p.pos.y + 1.2) : terrainH(m.x, m.z);
  m.face = f;
}
// jugador "fantasma" para el poder copiado: hereda todo de Bada pero con su propia posición, pose y modelo (el clon)
function ghostOf(sk, m) {
  const p = sk.p, g = Object.create(p);
  g.pos = new THREE.Vector3(m.x, m.y, m.z); g.facing = m.face;
  g.pose = { rx: 0, rz: 0, sy: 1, dy: 0, spin: 0, hidden: false, sc: 1 };
  g.vx = g.vy = g.vz = 0; g.casting = 0; g.scripted = false; g.powerAnim = 0; g.locked = false;
  const bones = {};
  m.main.copy.traverse((o) => { if (o.isBone) bones[o.name] = o; });
  if (p.model && p.model.bones) for (const k in p.model.bones) { const b = p.model.bones[k]; if (b && bones[b.name]) bones[k] = bones[b.name]; }
  g.model = { root: m.main.group, body: m.main.copy, bones, mixer: p.model && p.model.mixer, clips: p.model ? p.model.clips : {}, height: p.model ? p.model.height : p.H, boneFx: null };
  return g;
}
function tickPower(sk, m, dt) {
  if (m.state === 'vanish') return;
  if (m.copy) {
    // mientras dura el poder copiado, el clon se queda donde lo lanzó (la tormenta sale de él) y copia los gestos
    m.ghost.pos.set(m.x, m.y, m.z); m.ghost.facing = m.face;
    const c = sk.g.combat, s0 = c.src; c.src = m.copy;
    let done = true;
    try { done = m.copy.update(dt); } catch (e) { console.warn('clon azul:', e); }
    c.src = s0;
    if (done) { m.copy.dispose(); m.copy = null; sk.ward.vanish(m); } // poder ejecutado → desaparece
    return;
  }
  sideSpot(sk, m, false);
  m.jobT += dt;
  if (m.jobT > m.wait) { ui.banner('find', '🔵', 'El clon azul se desvanece: no has lanzado ningún poder'); sk.ward.vanish(m); }
}

/* 🔴 ROJO — RASTREADOR: anda con su propia animación (correr / reposo) usando el esqueleto del clon */
function makeRunner(sk, m) {
  const clips = sk.p.model && sk.p.model.clips;
  if (!clips || !clips.run) return;
  m.mixer = new THREE.AnimationMixer(m.main.copy);
  m.acts = {};
  for (const k of ['run', 'idle']) if (clips[k]) m.acts[k] = m.mixer.clipAction(clips[k]);
  m.anim = '';
  setAnim(m, 'idle');
}
function setAnim(m, name) {
  if (!m.mixer || m.anim === name || !m.acts[name]) return;
  const next = m.acts[name];
  next.reset().fadeIn(0.2).play();
  if (m.acts[m.anim]) m.acts[m.anim].fadeOut(0.2);
  m.anim = name;
}
// víctima libre más cercana al clon (que no esté siendo rescatada, ni bloqueada, ni a punto de recogerla Bada)
function pickTarget(sk, m) {
  const g = sk.g, P = sk.p.pos;
  let best = null, bd = Infinity;
  for (const v of g.victims) {
    if (v.state !== 'waiting' || v.hidden || v.thirsty || g.isBlocked(v) || g.bubbles.has(v)) continue;
    if (v._cloneClaim && v._cloneClaim !== m && v._cloneClaim.alive && v._cloneClaim.job === 'rescue') continue; // ya va otro clon a por ella
    if (Math.hypot(v.wpos.x - P.x, v.wpos.z - P.z) < 5) continue; // esa la está rescatando Bada
    const d = Math.hypot(v.wpos.x - m.x, v.wpos.z - m.z);
    if (d < bd) { bd = d; best = v; }
  }
  return best;
}
// ¿hay un sólido que no se puede subir en (x, z) a la altura del clon?
function blockedAt(sk, x, z, y) {
  const w = sk.g.world, r = 0.35;
  if (Math.abs(x) > 117 || Math.abs(z) > 117) return true;
  return w.solidsNear(x - r, x + r, z - r, z + r, []).some((s) => !s.dyn && x + r > s.x0 && x - r < s.x1 && z + r > s.z0 && z - r < s.z1 && s.y1 > y + 0.9 && s.y0 < y + 1.6);
}
// SALTO DE ESPEJISMO: si una pared le corta el paso, el clon se desvanece y reaparece unos metros más allá
// (es una ilusión de arena); nunca se queda atascado
function blinkToward(sk, m, tx, tz) {
  const dx = tx - m.x, dz = tz - m.z, L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L, p = sk.p;
  for (let d = Math.min(9, L); d >= 1.5; d -= 0.75) {
    const x = m.x + ux * d, z = m.z + uz * d, y = p.floorY ? p.floorY(x, z, Math.max(m.y, terrainH(x, z)) + 6) : terrainH(x, z);
    if (!blockedAt(sk, x, z, y)) {
      sk.ward.puff(m.x, m.y, m.z, 0.7, 0xff2e2e);
      m.x = x; m.z = z; m.y = y;
      sk.ward.puff(x, y, z, 0.7, 0xff2e2e);
      m.glow = 0.6;
      return true;
    }
  }
  return false;
}
function moveTo(sk, m, tx, tz, dt) {
  const p = sk.p, sp = (p.stats ? p.stats.speed : 6) * 1.15;
  const dx = tx - m.x, dz = tz - m.z, L = Math.hypot(dx, dz);
  if (L < 0.05) return L;
  const a0 = Math.atan2(dx, dz), step = Math.min(L, sp * dt);
  for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5]) {
    const a = a0 + off, x = m.x + Math.sin(a) * Math.max(step, 0.7), z = m.z + Math.cos(a) * Math.max(step, 0.7);
    const y = p.floorY ? p.floorY(x, z, m.y + 1.2) : terrainH(x, z);
    if (y > m.y + 1.2 || blockedAt(sk, x, z, y)) continue;
    m.x += Math.sin(a) * step; m.z += Math.cos(a) * step;
    m.y = p.floorY ? p.floorY(m.x, m.z, m.y + 1.2) : terrainH(m.x, m.z);
    m.face += angD(m.face, a) * Math.min(1, dt * 10);
    m.res.stuck = off === 0 ? 0 : m.res.stuck + dt * 0.5;
    break;
  }
  if (m.res.lastX !== undefined && Math.hypot(m.x - m.res.lastX, m.z - m.res.lastZ) < step * 0.25) m.res.stuck += dt;
  m.res.lastX = m.x; m.res.lastZ = m.z;
  if (m.res.stuck > 0.6) { m.res.stuck = 0; blinkToward(sk, m, tx, tz); }
  return Math.hypot(tx - m.x, tz - m.z);
}
function tickRescue(sk, m, dt) {
  if (m.state === 'vanish') return;
  const g = sk.g, R = m.res;
  R.t += dt; R.total += dt;
  m.glow = Math.max(0, (m.glow || 0) - dt * 2);
  m.owner.pos.set(m.x, m.y, m.z); m.owner.facing = m.face;
  if (g.state !== 'playing') { setAnim(m, 'idle'); return; } // juego en pausa / transición: espera quieto
  if (R.total > (sk.def.rescueMax || 150)) { abortRescue(sk, m, 'El clon rojo se ha desvanecido sin completar el rescate'); return; }
  if (R.st === 'search') {
    const v = pickTarget(sk, m);
    if (v) { R.target = v; v._cloneClaim = m; R.st = 'go'; R.t = 0; ui.banner('find', '🔴 Clon rastreador', `Ha encontrado a ${v.info.label}`); }
    else {
      // nadie disponible: espera junto a Bada (vuelve a buscar cada poco); si sigue sin haber nadie, se desvanece
      R.idle += dt;
      const P = sk.p.pos, f = sk.p.facing, tx = P.x + Math.cos(f) * 2, tz = P.z - Math.sin(f) * 2;
      const d = moveTo(sk, m, tx, tz, dt * (Math.hypot(tx - m.x, tz - m.z) > 1 ? 1 : 0));
      setAnim(m, d > 1 ? 'run' : 'idle');
      if (R.idle > (sk.def.searchWait || 20)) abortRescue(sk, m, 'No queda nadie que rescatar: el clon rojo se desvanece');
    }
    return;
  }
  if (R.st === 'go') {
    const v = R.target;
    if (!v || v.state !== 'waiting' || g.bubbles.has(v)) { if (v && v._cloneClaim === m) v._cloneClaim = null; R.st = 'search'; R.target = null; return; } // se la han llevado: busca otra
    const d = moveTo(sk, m, v.wpos.x, v.wpos.z, dt);
    setAnim(m, 'run');
    // señal roja sobre la víctima a la que va
    R.pingT -= dt;
    if (R.pingT <= 0) { R.pingT = 0.8; sk.vfx.ring(v.wpos.x, v.wpos.y + 0.05, v.wpos.z, { r0: 0.3, r1: 1.6, dur: 0.5, color: 0xff2e2e, opacity: 0.7 }); }
    const dy = Math.abs(v.wpos.y - m.y);
    if (d < 4 && dy > 1.6) { m.x = v.wpos.x + Math.sin(m.face) * -1.1; m.z = v.wpos.z + Math.cos(m.face) * -1.1; m.y = v.wpos.y; sk.ward.puff(m.x, m.y, m.z, 0.6, 0xff2e2e); } // sube / baja de un salto de espejismo
    if (d < 1.7 && Math.abs(v.wpos.y - m.y) < 1.8) {
      m.face = Math.atan2(v.wpos.x - m.x, v.wpos.z - m.z);
      if (g.pickupBy(v, m.owner)) {
        R.carry = v; R.st = 'return'; R.t = 0; v._cloneClaim = null;
        if (sk.v2) sk.v2.beam(new THREE.Vector3(m.x, m.y + sk.p.H * 0.6, m.z), new THREE.Vector3(v.wpos.x, v.wpos.y + (v.height || 1) * 0.5, v.wpos.z), { r: 0.07, color: 0xff6a6a, opacity: 0.8, life: 0.3 });
      } else { if (v._cloneClaim === m) v._cloneClaim = null; R.st = 'search'; R.target = null; }
    }
    return;
  }
  if (R.st === 'return') {
    const v = R.carry, S = CFG.SAFE;
    if (!v || v.state !== 'carried') { R.carry = null; R.st = 'search'; return; }
    const d = moveTo(sk, m, S.x, S.z, dt);
    setAnim(m, 'run');
    if (d < S.r * 0.55) {
      // ENTREGA: solo cuando queda registrada como rescatada desaparece el clon
      const at = new THREE.Vector3(m.x, m.y, m.z);
      if (g.deliverByClone(v, at)) { R.carry = null; R.st = 'done'; setAnim(m, 'idle'); if (sk.ward && !sk.ward.done) sk.ward.vanish(m); }
    }
  }
}
// el clon rojo se va sin completar el rescate: suelta a la víctima (vuelve a esperar donde está) y desaparece
export function abortRescue(sk, m, msg) {
  if (m.res && m.res.target && m.res.target._cloneClaim === m) m.res.target._cloneClaim = null;
  if (m.res && m.res.carry) { sk.g.releaseVictim(m.res.carry); m.res.carry = null; }
  if (msg) ui.banner('find', '🔴', msg);
  if (sk.ward && !sk.ward.done) sk.ward.vanish(m);
}

export function tickJobs(sk, dt) {
  const w = sk.ward;
  if (!w) return;
  for (const m of w.mirrors) {
    if (!m.alive || !m.job) continue;
    if (m.job === 'power') tickPower(sk, m, dt);
    else if (m.job === 'rescue') tickRescue(sk, m, dt);
    if (w.done) return; // una entrega puede haber terminado la misión (y limpiado los poderes)
  }
}
// limpieza: ningún proceso queda vivo (poder copiado detenido, víctima en burbuja liberada)
export function disposeJobs(sk) {
  const w = sk.ward;
  if (!w) return;
  for (const m of w.mirrors) {
    if (m.copy) { m.copy.dispose(); m.copy = null; }
    if (m.res && m.res.target && m.res.target._cloneClaim === m) m.res.target._cloneClaim = null;
    if (m.res && m.res.carry) { sk.g.releaseVictim(m.res.carry); m.res.carry = null; }
  }
}
