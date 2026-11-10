// Animaciones de los JEFES DE ZONA con el mismo tipo de esqueleto que los héroes (huesos con nombre, sin rotación de
// reposo: cada clave es la rotación local absoluta). Uso: node make_boss_anims.mjs ENTRADA.glb SALIDA.glb
// Detecta el tipo de cuerpo por sus huesos:
//   · bípedo (minotauro, medusa): piernas thigh/shin/foot y brazos upper_arm/forearm
//   · cuadrúpedo (kerberos, fenrir, basilisco): columna horizontal; patas traseras = piernas, delanteras = brazos
//   · tentáculos (kraken): brazos + colas tail_<nombre>_N como tentáculos
//   · serpiente/dragón enroscado (long): solo columna, cuello, cabeza y cola
// Clips: idle, walk, run, charge, attack, hit, death, cele (los nombres los usa src/bosses.js).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const [, , input, output] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();
const buffer = root.listBuffers()[0];
const bones = {};
for (const n of root.listNodes()) bones[n.getName()] = n;
const FPS = 30, TAU = Math.PI * 2, S = Math.sin, C = Math.cos;
const has = (n) => !!bones[n];

// posición en reposo (mundo) de un hueso
const wpos = (n) => { let t = [0, 0, 0], x = bones[n]; while (x) { const p = x.getTranslation(); t = [t[0] + p[0], t[1] + p[1], t[2] + p[2]]; x = x.getParentNode(); } return t; };
const rootP = wpos('root'), chestP = has('chest') ? wpos('chest') : rootP;
const LEGS = has('thigh_L'), ARMS = has('upper_arm_L');
const QUAD = LEGS && ARMS && Math.abs(chestP[2] - rootP[2]) > Math.abs(chestP[1] - rootP[1]);
const TENT = !LEGS && ARMS;
const SNAKE = !LEGS && !ARMS;
console.log('tipo:', QUAD ? 'cuadrúpedo' : TENT ? 'tentáculos' : SNAKE ? 'serpiente' : 'bípedo');

function quat(x, y, z) {
  const c1 = C(x / 2), c2 = C(y / 2), c3 = C(z / 2), s1 = S(x / 2), s2 = S(y / 2), s3 = S(z / 2);
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3];
}
function makeClip(name, duration, pose) {
  const frames = Math.round(duration * FPS);
  const times = new Float32Array(frames + 1), rot = {}, rootPos = new Float32Array((frames + 1) * 3);
  const base = bones.root.getTranslation();
  for (let f = 0; f <= frames; f++) {
    const t = f / frames;
    times[f] = f / FPS;
    const p = pose(t);
    for (const [b, e] of Object.entries(p.bones)) {
      if (!bones[b]) continue;
      (rot[b] = rot[b] || new Float32Array((frames + 1) * 4)).set(quat(e[0] || 0, e[1] || 0, e[2] || 0), f * 4);
    }
    rootPos.set([base[0] + (p.dx || 0), base[1] + (p.dy || 0), base[2] + (p.dz || 0)], f * 3);
  }
  const anim = doc.createAnimation(name);
  const inp = doc.createAccessor(name + '_t').setArray(times).setType('SCALAR').setBuffer(buffer);
  for (const [b, arr] of Object.entries(rot)) {
    for (let f = 0; f <= frames; f++) if (!arr[f * 4] && !arr[f * 4 + 1] && !arr[f * 4 + 2] && !arr[f * 4 + 3]) arr[f * 4 + 3] = 1;
    const out = doc.createAccessor(`${name}_${b}_r`).setArray(arr).setType('VEC4').setBuffer(buffer);
    const smp = doc.createAnimationSampler().setInput(inp).setOutput(out).setInterpolation('LINEAR');
    anim.addSampler(smp).addChannel(doc.createAnimationChannel().setTargetNode(bones[b]).setTargetPath('rotation').setSampler(smp));
  }
  const outP = doc.createAccessor(name + '_root_p').setArray(rootPos).setType('VEC3').setBuffer(buffer);
  const sp = doc.createAnimationSampler().setInput(inp).setOutput(outP).setInterpolation('LINEAR');
  anim.addSampler(sp).addChannel(doc.createAnimationChannel().setTargetNode(bones.root).setTargetPath('translation').setSampler(sp));
}

// colas / tentáculos: cada cadena ondula con retraso creciente
const TAILS = {};
for (const n of Object.keys(bones)) { const m = n.match(/^tail(?:_([a-z]+))?_(\d+)$/); if (m) (TAILS[m[1] || ''] = TAILS[m[1] || ''] || []).push([Number(m[2]), n]); }
const TG = Object.values(TAILS).map((g) => g.sort((a, b) => a[0] - b[0]).map((x) => x[1]));
const tail = (t, amp, speed = 1, lift = 0) => {
  const o = {};
  TG.forEach((names, gi) => names.forEach((b, i) => {
    const per = amp * 4 / names.length, ph = t * TAU * speed - (i + 1) * 0.8 + gi * 1.3;
    o[b] = TENT ? [lift * 4 / names.length + S(ph) * per, 0, S(ph + 1.1) * per * 0.6] : [lift * 4 / names.length + S(ph * 0.5) * per * 0.25, S(ph) * per, 0];
  }));
  return o;
};
const merge = (...a) => Object.assign({}, ...a);
const sm = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
const H = Math.max(0.3, wpos('head')[1]); // altura de la cabeza (para el balanceo de la raíz)

// marcha: piernas y patas delanteras (en trote, la delantera izquierda va con la trasera derecha)
function gait(t, k) {
  const a = t * TAU, sL = S(a), sR = S(a + Math.PI), sw = 0.42 * k, knee = 0.65 * k;
  const o = {};
  if (LEGS) Object.assign(o, {
    thigh_L: [-sL * sw, 0, 0], thigh_R: [-sR * sw, 0, 0],
    shin_L: [Math.max(0, S(a + 1.2)) * knee, 0, 0], shin_R: [Math.max(0, S(a + 1.2 + Math.PI)) * knee, 0, 0],
    foot_L: [sL * 0.2 * k, 0, 0], foot_R: [sR * 0.2 * k, 0, 0],
  });
  if (ARMS) {
    if (QUAD) Object.assign(o, { upper_arm_L: [-sR * sw, 0, 0], upper_arm_R: [-sL * sw, 0, 0], forearm_L: [-Math.max(0, S(a + 1.2 + Math.PI)) * knee, 0, 0], forearm_R: [-Math.max(0, S(a + 1.2)) * knee, 0, 0], hand_L: [sR * 0.25 * k, 0, 0], hand_R: [sL * 0.25 * k, 0, 0] });
    else Object.assign(o, { upper_arm_L: [sL * 0.45 * k, 0, -0.1], upper_arm_R: [sR * 0.45 * k, 0, 0.1], forearm_L: [-0.35 - Math.max(0, -sL) * 0.4 * k, 0, 0], forearm_R: [-0.35 - Math.max(0, -sR) * 0.4 * k, 0, 0] });
  }
  return o;
}

// REPOSO: respira, mira a los lados, la cola se mece
makeClip('idle', 2.6, (t) => {
  const a = t * TAU;
  return { dy: S(a) * 0.006, bones: merge(
    { spine: [S(a) * 0.025, 0, 0], chest: [S(a + 0.6) * 0.03, S(a) * 0.04, 0], neck: [S(a * 2) * 0.03, 0, 0], head: [S(a * 2 + 1) * 0.04, S(a) * 0.15, 0] },
    ARMS && !QUAD ? { upper_arm_L: [S(a) * 0.05, 0, -0.08], upper_arm_R: [S(a + 0.5) * 0.05, 0, 0.08], forearm_L: [-0.25, 0, 0], forearm_R: [-0.25, 0, 0] } : {},
    SNAKE ? { root: [0, S(a) * 0.05, S(a) * 0.03], spine: [S(a) * 0.04, S(a + 1) * 0.08, 0], chest: [S(a + 1.5) * 0.05, S(a + 2) * 0.1, 0] } : {},
    tail(t, 0.22, 1),
  ) };
});
// CAMINAR / CORRER / CARGAR (embestida con la cabeza baja)
const move = (name, dur, k, charge = 0) => makeClip(name, dur, (t) => {
  const a = t * TAU;
  return { dy: Math.abs(S(a)) * 0.012 * k * (QUAD ? 0.6 : 1), bones: merge(
    gait(t, k),
    QUAD ? { spine: [S(a * 2) * 0.03 * k, S(a) * 0.04, 0], chest: [-S(a * 2) * 0.03 * k, 0, 0], neck: [0.12 * charge + S(a * 2) * 0.04, 0, 0], head: [0.25 * charge - S(a * 2) * 0.05, S(a) * 0.05, 0] }
      : { spine: [0.06 * k + 0.25 * charge, S(a) * 0.08, 0], chest: [0.03 * k + 0.1 * charge, -S(a) * 0.06, 0], head: [-0.05 * k + 0.15 * charge, -S(a) * 0.05, 0] },
    SNAKE ? { root: [0.1 * k, S(a) * 0.12, 0], spine: [S(a) * 0.06, S(a + 1) * 0.15 * k, 0], chest: [S(a + 1.5) * 0.06, S(a + 2) * 0.15 * k, 0], neck: [0.15 * charge, S(a + 2.5) * 0.1, 0] } : {},
    TENT ? tail(t, 0.35 * k, 2, 0.2 * k) : tail(t, 0.25 * (0.6 + k * 0.5), 2, 0.1 * k),
  ) };
});
move('walk', 1.3, 1);
move('run', 0.75, 1.7);
move('charge', 0.6, 1.9, 1);

// ATAQUE (una vez): carga hacia atrás (0-40 %) → golpe (40-55 %) → recupera
makeClip('attack', 1.1, (t) => {
  const up = sm(0, 0.4, t) * (1 - sm(0.4, 0.5, t)), down = sm(0.4, 0.5, t) * (1 - sm(0.6, 1, t));
  const o = {};
  if (QUAD) Object.assign(o, { // se alza sobre las patas traseras y cae mordiendo / golpeando con las delanteras
    root: [-0.35 * up + 0.12 * down, 0, 0], spine: [-0.1 * up + 0.1 * down, 0, 0], neck: [-0.4 * up + 0.35 * down, 0, 0], head: [-0.3 * up + 0.4 * down, 0, 0],
    upper_arm_L: [-0.9 * up - 0.5 * down, 0, 0], upper_arm_R: [-0.9 * up - 0.5 * down, 0, 0], forearm_L: [-0.8 * up, 0, 0], forearm_R: [-0.8 * up, 0, 0],
    thigh_L: [0.35 * up, 0, 0], thigh_R: [0.35 * up, 0, 0], shin_L: [0.3 * up, 0, 0], shin_R: [0.3 * up, 0, 0],
  });
  else if (SNAKE) Object.assign(o, { spine: [-0.3 * up + 0.3 * down, 0, 0], chest: [-0.35 * up + 0.4 * down, 0, 0], neck: [-0.4 * up + 0.5 * down, 0, 0], head: [-0.3 * up + 0.4 * down, 0, 0] });
  else Object.assign(o, { // bípedo / kraken: alza los brazos y golpea hacia delante
    spine: [-0.18 * up + 0.3 * down, 0, 0], chest: [-0.12 * up + 0.15 * down, 0, 0], head: [-0.2 * up + 0.1 * down, 0, 0],
    upper_arm_L: [-2.5 * up - 0.9 * down, 0, -0.25 * up], upper_arm_R: [-2.5 * up - 0.9 * down, 0, 0.25 * up], forearm_L: [-0.6 * up, 0, 0], forearm_R: [-0.6 * up, 0, 0],
    ...(LEGS ? { thigh_L: [-0.25 * down, 0, 0], thigh_R: [0.15 * down, 0, 0], shin_L: [0.3 * down, 0, 0], shin_R: [0.2 * down, 0, 0] } : {}),
  });
  return { dy: (QUAD ? 0.06 * up : 0) - 0.03 * down * H, bones: merge(o, tail(t, 0.3, 1, TENT ? 0.6 * up - 0.3 * down : 0.2 * up)) };
});
// IMPACTO (una vez): retrocede encogido y vuelve
makeClip('hit', 0.5, (t) => {
  const k = S(Math.min(1, t * 1.6) * Math.PI) * (1 - sm(0.6, 1, t)) + (t < 0.3 ? S(t / 0.3 * Math.PI) * 0.3 : 0);
  return { dz: -0.02 * k, bones: merge(
    { spine: [-0.18 * k, 0.08 * k, 0], chest: [-0.12 * k, 0, 0], neck: [-0.2 * k, 0, 0], head: [-0.3 * k, 0.15 * k, 0] },
    ARMS && !QUAD ? { upper_arm_L: [-0.5 * k, 0, -0.4 * k], upper_arm_R: [-0.5 * k, 0, 0.4 * k], forearm_L: [-0.8 * k, 0, 0], forearm_R: [-0.8 * k, 0, 0] } : {},
    tail(t, 0.2 * k, 2),
  ) };
});
// DERROTA (una vez, se queda en el último fotograma): se tambalea y se desploma
makeClip('death', 1.8, (t) => {
  const s = sm(0, 0.35, t) * (1 - sm(0.35, 0.5, t)), f = sm(0.3, 0.85, t);
  const o = {};
  if (QUAD) Object.assign(o, { root: [0, 0, 0.3 * f], spine: [0.1 * f, 0, 0], neck: [0.5 * f, 0, 0.2 * f], head: [0.4 * f, 0.3 * f, 0],
    thigh_L: [-0.9 * f, 0, 0.4 * f], thigh_R: [-0.9 * f, 0, -0.3 * f], shin_L: [1.4 * f, 0, 0], shin_R: [1.3 * f, 0, 0],
    upper_arm_L: [0.9 * f, 0, 0.3 * f], upper_arm_R: [0.9 * f, 0, -0.3 * f], forearm_L: [-1.2 * f, 0, 0], forearm_R: [-1.2 * f, 0, 0] });
  else if (SNAKE) Object.assign(o, { root: [0.4 * f, 0, 0.2 * f], spine: [0.5 * f, 0.3 * f, 0], chest: [0.6 * f, 0.2 * f, 0], neck: [0.5 * f, 0, 0], head: [0.4 * f, 0, 0] });
  else Object.assign(o, { spine: [-0.2 * s + 0.5 * f, 0.2 * s, 0], chest: [0.3 * f, 0, 0], neck: [0.3 * f, 0, 0], head: [-0.3 * s + 0.4 * f, 0, 0],
    upper_arm_L: [-0.8 * s + 0.3 * f, 0, -0.5 * f], upper_arm_R: [-0.8 * s + 0.3 * f, 0, 0.5 * f], forearm_L: [-0.5 * f, 0, 0], forearm_R: [-0.5 * f, 0, 0],
    ...(LEGS ? { thigh_L: [-1.2 * f, 0, 0.15 * f], thigh_R: [-1.0 * f, 0, -0.15 * f], shin_L: [2.0 * f, 0, 0], shin_R: [1.8 * f, 0, 0], foot_L: [-0.6 * f, 0, 0], foot_R: [-0.6 * f, 0, 0] } : {}) });
  const drop = LEGS && !QUAD ? -0.32 : QUAD ? -0.18 : -0.1;
  return { dy: drop * f * H, bones: merge(o, tail(t, 0.15 * (1 - f), 2, -0.3 * f)) };
});
// VICTORIA / RUGIDO (bucle): cabeza arriba, brazos o patas en alto
makeClip('cele', 1.6, (t) => {
  const a = t * TAU, k = 0.8 + 0.2 * S(a * 2);
  const o = QUAD
    ? { root: [-0.25 * k, 0, 0], neck: [-0.55 * k, 0, 0], head: [-0.4 * k + S(a * 4) * 0.05, 0, 0], upper_arm_L: [-0.6 * k, 0, 0], upper_arm_R: [-0.4 * k, 0, 0], forearm_L: [-0.6, 0, 0], forearm_R: [-0.5, 0, 0], thigh_L: [0.25 * k, 0, 0], thigh_R: [0.25 * k, 0, 0] }
    : SNAKE ? { spine: [-0.2 * k, S(a) * 0.15, 0], chest: [-0.25 * k, S(a + 1) * 0.15, 0], neck: [-0.4 * k, 0, 0], head: [-0.35 * k, 0, 0] }
    : { spine: [-0.15 * k, 0, 0], chest: [-0.12 * k, 0, 0], head: [-0.45 * k, 0, 0], upper_arm_L: [-2.6 + S(a * 3) * 0.25, 0, -0.5], upper_arm_R: [-2.6 + S(a * 3 + Math.PI) * 0.25, 0, 0.5], forearm_L: [-0.4, 0, 0], forearm_R: [-0.4, 0, 0] };
  return { dy: QUAD ? 0.05 * k : Math.abs(S(a)) * 0.01, bones: merge(o, tail(t, 0.45, 2, TENT ? 0.5 : 0.3)) };
});

await io.write(output, doc);
console.log('animaciones:', root.listAnimations().map((x) => x.getName()).join(', '));
