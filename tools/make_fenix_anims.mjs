// Animaciones del FÉNIX OSCURO (jefe volador) para el esqueleto de tools/rigspecs/fenix.json.
// Uso: node make_fenix_anims.mjs RIG.glb SALIDA.glb
// Mismo convenio que tools/make_boss_anims.mjs (huesos sin rotación de reposo: cada clave es la rotación local absoluta)
// y mismos NOMBRES de clip que usa src/bosses.js: idle, walk, run, charge, attack, hit, guard, stagger, death, cele.
// Un ave no camina: "walk"/"run" son vuelo de avance (aleteo más amplio y rápido, cuerpo inclinado, patas recogidas).
// Ejes: el ave mira a +Z, arriba +Y, su izquierda +X. Ala izquierda: +Z sube, +Y la lleva hacia atrás (en la derecha, al revés).
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
const merge = (...a) => Object.assign({}, ...a);
const sm = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };

// ALAS: o = { up (alzado del hombro), amp (amplitud del aleteo), ph (fase), back (barrido hacia atrás), fold (pliegue
// del codo y la muñeca), twist (giro del borde de ataque), lag (retraso entre segmentos: la punta va detrás del hombro) }
function wings(o) {
  const r = {}, amp = o.amp ?? 0, ph = o.ph ?? 0, lag = o.lag ?? 0.55, up = o.up ?? 0, back = o.back ?? 0, fold = o.fold ?? 0, tw = o.twist ?? 0;
  for (const [sd, s] of [['L', 1], ['R', -1]]) {
    const w = (k) => S(ph - k * lag);
    // en la bajada el ala se extiende y avanza; en la subida se pliega un poco (recobro natural)
    const recov = Math.max(0, C(ph - 0.4)) * amp * 0.35;
    r[`wing_${sd}_1`] = [tw + 0.12 * amp * C(ph), s * (back - 0.12 * amp * S(ph)), s * (up + amp * w(0))];
    r[`wing_${sd}_2`] = [tw * 0.5, s * (back * 0.6 + recov * 0.6 + fold * 0.5), s * (amp * 0.8 * w(1) - fold * 0.35)];
    r[`wing_${sd}_3`] = [tw * 0.3, s * (back * 0.4 + recov + fold * 0.9), s * (amp * 0.7 * w(2) - fold * 0.25)];
    r[`wing_${sd}_4`] = [0, s * (back * 0.3 + recov * 0.6 + fold * 0.5), s * (amp * 0.6 * w(3))];
  }
  return r;
}
// COLA en abanico: cada pluma ondula con retraso; `back` la lleva hacia atrás (vuelo), `spread` abre el abanico
const CHAINS = { c: 0, la: 1, ra: -1, lb: 1, rb: -1 };
function tail(o) {
  const r = {}, ph = o.ph ?? 0, amp = o.amp ?? 0.1, back = o.back ?? 0, spread = o.spread ?? 0;
  for (const [c, s] of Object.entries(CHAINS)) {
    const off = { c: 0, la: 0.9, ra: 1.7, lb: 2.4, rb: 3.1 }[c];
    for (let k = 1; k <= 4; k++) {
      const wv = S(ph - k * 0.8 + off) * amp * (0.6 + k * 0.25);
      r[`tail_${c}_${k}`] = [(k === 1 ? back : back * 0.25) + wv, 0, s * ((k === 1 ? spread : spread * 0.3) + S(ph * 0.5 - k * 0.6 + off) * amp * 0.5)];
    }
  }
  return r;
}
// PATAS: tuck 0 = colgando relajadas, 1 = recogidas hacia delante (vuelo rápido); grip cierra las garras
function legs(o) {
  const tk = o.tuck ?? 0, sw = o.sway ?? 0, g = o.grip ?? 0, r = {};
  for (const [sd, ph] of [['L', 0], ['R', 1.3]]) {
    const w = S((o.ph ?? 0) + ph) * sw;
    r[`thigh_${sd}`] = [-0.55 * tk + w, 0, 0];
    r[`shin_${sd}`] = [0.75 * tk - w * 0.5, 0, 0];
    r[`foot_${sd}`] = [-0.35 * tk + 0.25 * g, 0, 0];
    r[`toe_${sd}`] = [0.5 * g + 0.25 * tk, 0, 0];
  }
  return r;
}

// REPOSO EN VUELO (cernido): dos aleteos lentos, la cabeza vigila a los lados, la cola ondula
makeClip('idle', 2.4, (t) => {
  const a = t * TAU, ph = a * 2;
  return { dy: -S(ph - 0.6) * 0.012, bones: merge(
    wings({ up: 0.05, amp: 0.42, ph, twist: 0.06 }),
    { root: [0.05 + S(ph) * 0.03, 0, 0], spine: [S(ph + 0.5) * 0.03, 0, 0], chest: [S(ph + 1) * 0.03, 0, 0],
      neck: [-0.05 + S(ph + 1.5) * 0.05, S(a) * 0.18, 0], head: [0.05 - S(ph + 2) * 0.05, S(a) * 0.25, S(a * 2) * 0.04] },
    tail({ ph: a * 2, amp: 0.07, back: 0.05 }),
    legs({ tuck: 0.15, sway: 0.08, ph: a * 2, grip: 0.2 }),
  ) };
});
// VUELO DE AVANCE ("walk") y VUELO RÁPIDO ("run"): cuerpo inclinado, aleteo amplio, patas recogidas, cola estirada atrás
const fly = (name, dur, k) => makeClip(name, dur, (t) => {
  const ph = t * TAU;
  return { dy: -S(ph - 0.6) * 0.014 * k, bones: merge(
    wings({ up: 0.02, amp: 0.5 + 0.12 * k, ph, twist: 0.12 * k }),
    { root: [0.2 * k + S(ph) * 0.03, 0, 0], spine: [S(ph + 0.5) * 0.03, 0, 0], chest: [-0.05 + S(ph + 1) * 0.03, 0, 0],
      neck: [-0.12 * k + S(ph + 1.5) * 0.04, 0, 0], head: [-0.08 * k - S(ph + 2) * 0.04, 0, 0] },
    tail({ ph: ph * 2, amp: 0.06 + 0.03 * k, back: 0.25 * k }),
    legs({ tuck: 0.5 + 0.35 * k, sway: 0.04, ph }),
  ) };
});
fly('walk', 1.0, 0.8);
fly('run', 0.7, 1.4);
// PICADO ÍGNEO ("charge"): alas barridas atrás y medio plegadas como una flecha, cabeza adelantada, puntas que vibran
makeClip('charge', 0.6, (t) => {
  const ph = t * TAU;
  return { dy: 0, bones: merge(
    wings({ up: -0.1, amp: 0.08, ph: ph * 2, lag: 0.4, back: 0.75, fold: 0.6, twist: 0.25 }),
    { root: [0.55, 0, S(ph) * 0.03], spine: [0.05, 0, 0], chest: [-0.05, 0, 0], neck: [-0.35, 0, 0], head: [-0.15 + S(ph * 2) * 0.03, 0, 0] },
    tail({ ph: ph * 2, amp: 0.05, back: 0.55, spread: -0.08 }),
    legs({ tuck: 1, grip: 0.6 }),
  ) };
});
// ATAQUE (una vez): alza las alas muy alto y echa el cuello atrás (0-40 %) → batida brutal hacia abajo y estocada de pico
// con las garras por delante (40-55 %) → recupera el cernido
makeClip('attack', 1.1, (t) => {
  const up = sm(0, 0.4, t) * (1 - sm(0.4, 0.52, t)), down = sm(0.4, 0.52, t) * (1 - sm(0.62, 1, t));
  const rest = 1 - up - down, ph = t * TAU;
  return { dy: 0.02 * up - 0.025 * down, bones: merge(
    wings({ up: 0.75 * up - 0.7 * down + 0.05 * rest, amp: 0.15 * rest, ph: ph * 2, back: 0.35 * up - 0.25 * down, fold: 0.25 * up, twist: -0.2 * up + 0.25 * down }),
    { root: [-0.25 * up + 0.35 * down, 0, 0], spine: [-0.1 * up + 0.12 * down, 0, 0], chest: [-0.1 * up + 0.1 * down, 0, 0],
      neck: [-0.45 * up + 0.55 * down, 0, 0], head: [-0.3 * up + 0.35 * down, 0, 0] },
    tail({ ph: ph * 2, amp: 0.08, back: -0.1 * up + 0.2 * down, spread: 0.25 * up }),
    legs({ tuck: -0.4 * up + 0.2 * rest, grip: 0.8 * down + 0.2, sway: 0 }),
  ) };
});
// IMPACTO (una vez): se encoge hacia atrás, las alas dan un respingo hacia arriba y vuelve
makeClip('hit', 0.5, (t) => {
  const k = S(Math.min(1, t * 1.6) * Math.PI) * (1 - sm(0.6, 1, t));
  return { dz: -0.015 * k, bones: merge(
    wings({ up: 0.35 * k, amp: 0.1, ph: t * TAU * 2, back: 0.2 * k, fold: 0.3 * k }),
    { root: [-0.3 * k, 0, 0.06 * k], spine: [-0.1 * k, 0, 0], neck: [-0.3 * k, 0.1 * k, 0], head: [-0.35 * k, 0.2 * k, 0] },
    tail({ ph: t * TAU * 2, amp: 0.15 * k }),
    legs({ tuck: 0.6 * k, grip: 0.8 * k }),
  ) };
});
// DEFENSA (bucle): envuelve el cuerpo con las alas por delante (escudo de plumas) y esconde la cabeza
makeClip('guard', 1.2, (t) => {
  const a = t * TAU, b = S(a) * 0.04;
  return { dy: b * 0.1, bones: merge(
    wings({ up: -0.15 + b, amp: 0.04, ph: a * 2, back: -0.95, fold: 0.35, twist: 0.35 }),
    { root: [0.1, 0, 0], spine: [0.12, 0, 0], chest: [0.1, 0, 0], neck: [0.3 + b, 0, 0], head: [0.25, 0, 0] },
    tail({ ph: a, amp: 0.05, back: -0.15, spread: -0.05 }),
    legs({ tuck: 0.9, grip: 0.7 }),
  ) };
});
// TAMBALEO (una vez): golpe poderoso — voltereta hacia atrás, alas descontroladas y recupera el vuelo
makeClip('stagger', 1.3, (t) => {
  const k = sm(0, 0.12, t) * (1 - sm(0.55, 1, t)), w = S(t * TAU * 2.2) * (1 - sm(0.2, 0.9, t));
  return { dz: -0.03 * k, dy: -0.02 * k, bones: merge(
    wings({ up: 0.2 * k + 0.3 * w, amp: 0.35 * k + 0.2, ph: t * TAU * 3, back: 0.3 * w, fold: 0.4 * k }),
    { root: [-0.5 * k, 0.15 * w, 0.25 * w], spine: [-0.15 * k, 0, 0], neck: [-0.4 * k, 0.3 * w, 0], head: [-0.4 * k, 0.35 * w, 0] },
    tail({ ph: t * TAU * 3, amp: 0.25 * k + 0.05 }),
    legs({ tuck: 0.3 + 0.5 * k, sway: 0.3 * k, ph: t * TAU * 3, grip: 0.5 }),
  ) };
});
// DERROTA (una vez, queda en el último fotograma): un último aleteo desesperado y cae con las alas desplomadas
makeClip('death', 1.8, (t) => {
  const s = sm(0, 0.3, t) * (1 - sm(0.3, 0.45, t)), f = sm(0.3, 0.9, t);
  return { dy: -0.06 * f, bones: merge(
    wings({ up: 0.5 * s - 0.9 * f, amp: 0.3 * (1 - f), ph: t * TAU * 3, back: 0.3 * f, fold: 0.3 * f, twist: 0.3 * f }),
    { root: [0.15 * s + 0.6 * f, 0, 0.25 * f], spine: [0.15 * f, 0, 0], chest: [0.1 * f, 0, 0], neck: [-0.4 * s + 0.6 * f, 0, 0.2 * f], head: [-0.3 * s + 0.5 * f, 0.4 * f, 0] },
    tail({ ph: t * TAU, amp: 0.12 * (1 - f), back: -0.2 * f, spread: -0.1 * f }),
    legs({ tuck: 0.2 * (1 - f), sway: 0, grip: 0.9 * f }),
  ) };
});
// VICTORIA / GRITO (bucle): alas abiertas en alto, cabeza levantada chillando, cola desplegada en abanico
makeClip('cele', 1.6, (t) => {
  const a = t * TAU, k = 0.85 + 0.15 * S(a * 2);
  return { dy: Math.abs(S(a)) * 0.01, bones: merge(
    wings({ up: 0.35 * k, amp: 0.3, ph: a, twist: -0.1 }),
    { root: [-0.12 * k, 0, 0], spine: [-0.08 * k, 0, 0], chest: [-0.1 * k, 0, 0], neck: [-0.3 * k, 0, 0], head: [-0.45 * k + S(a * 6) * 0.05, 0, 0] },
    tail({ ph: a * 2, amp: 0.12, spread: 0.3 }),
    legs({ tuck: 0.1, sway: 0.1, ph: a * 2, grip: 0.4 }),
  ) };
});

await io.write(output, doc);
console.log('animaciones:', root.listAnimations().map((x) => x.getName()).join(', '));
