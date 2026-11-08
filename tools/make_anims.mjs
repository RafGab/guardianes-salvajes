// Genera las animaciones de un personaje con el rig "Claude rig" (huesos con nombre) y las escribe en el GLB.
// Uso: node make_anims.mjs ENTRADA.glb SALIDA.glb
// Convención del rig: el personaje mira a +Z, arriba es +Y, su izquierda es +X; los huesos no tienen rotación de reposo,
// así que cada clave de rotación es la rotación local absoluta del hueso.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const [, , input, output] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();
const buffer = root.listBuffers()[0];

const bones = {};
for (const n of root.listNodes()) bones[n.getName()] = n;
const FPS = 30;
const TAU = Math.PI * 2;

// quaternion desde euler (x, y, z) en orden XYZ
function quat(x, y, z) {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

// pose(t, k) con t en [0,1) del ciclo -> { hueso: [rx, ry, rz], root_y: desplazamiento vertical }
function makeClip(name, duration, pose) {
  const frames = Math.round(duration * FPS);
  const times = new Float32Array(frames + 1);
  const rot = {};
  const rootPos = new Float32Array((frames + 1) * 3);
  const base = bones.root.getTranslation();
  for (let f = 0; f <= frames; f++) {
    const t = f / frames; // el último fotograma = el primero (bucle perfecto)
    times[f] = f / FPS;
    const p = pose(t % 1);
    if (WING_N && WING_PROFILE[name]) Object.assign(p.bones, wings(t % 1, ...WING_PROFILE[name]));
    for (const [b, e] of Object.entries(p.bones)) {
      if (!bones[b]) continue;
      (rot[b] = rot[b] || new Float32Array((frames + 1) * 4)).set(quat(e[0] || 0, e[1] || 0, e[2] || 0), f * 4);
    }
    rootPos.set([base[0] + (p.dx || 0), base[1] + (p.dy || 0), base[2] + (p.dz || 0)], f * 3);
  }
  const anim = doc.createAnimation(name);
  const input = doc.createAccessor(name + '_t').setArray(times).setType('SCALAR').setBuffer(buffer);
  for (const [b, arr] of Object.entries(rot)) {
    // los huesos sin movimiento en algún fotograma deben tener la identidad
    for (let f = 0; f <= frames; f++) if (arr[f * 4 + 3] === 0 && arr[f * 4] === 0 && arr[f * 4 + 1] === 0 && arr[f * 4 + 2] === 0) arr[f * 4 + 3] = 1;
    const out = doc.createAccessor(`${name}_${b}_r`).setArray(arr).setType('VEC4').setBuffer(buffer);
    const sampler = doc.createAnimationSampler().setInput(input).setOutput(out).setInterpolation('LINEAR');
    anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(bones[b]).setTargetPath('rotation').setSampler(sampler));
  }
  const outP = doc.createAccessor(name + '_root_p').setArray(rootPos).setType('VEC3').setBuffer(buffer);
  const sp = doc.createAnimationSampler().setInput(input).setOutput(outP).setInterpolation('LINEAR');
  anim.addSampler(sp).addChannel(doc.createAnimationChannel().setTargetNode(bones.root).setTargetPath('translation').setSampler(sp));
  return anim;
}

const S = Math.sin, C = Math.cos;
// Colas: se detectan por nombre (tail_N o tail_<color>_N). Cada cola es un grupo de huesos con retardo creciente (ondulación)
const TAILS = {};
for (const n of Object.keys(bones)) {
  const m = n.match(/^tail(?:_([a-z]+))?_(\d+)$/);
  if (m) (TAILS[m[1] || ''] = TAILS[m[1] || ''] || []).push([Number(m[2]), n]);
}
const TAIL_GROUPS = Object.values(TAILS).map((g) => g.sort((a, b) => a[0] - b[0]).map((x) => x[1]));
const TAIL_Z = TAIL_GROUPS.length > 1 ? 0.8 : 0; // varias colas que apuntan hacia arriba: también ondulan de lado a lado en Z
const tail = (t, amp, speed = 1, lift = 0) => {
  const o = {};
  TAIL_GROUPS.forEach((names, gi) => {
    const per = amp * 5 / names.length; // la amplitud total no depende del número de huesos
    names.forEach((b, i) => {
      const ph = t * TAU * speed - (i + 1) * 0.7 + gi * 1.1;
      o[b] = [lift * 5 / names.length + S(ph * 0.5) * per * 0.25, S(ph) * per, S(ph + 1.3) * per * TAIL_Z];
    });
  });
  return o;
};
// Orejas: ear_L_k / ear_R_k (k = 1..n); z = abrir hacia fuera, x = adelante/atrás
const EAR_N = Math.max(...Object.keys(bones).map((n) => { const m = n.match(/^ear_L_(\d+)$/); return m ? Number(m[1]) : 0; }), 0);
const ears = (t, amp, speed = 1, back = 0, phase = 0) => {
  const o = {};
  for (let i = 1; i <= EAR_N; i++) {
    const ph = t * TAU * speed - i * 0.5 + phase;
    o['ear_L_' + i] = [back + S(ph + 0.6) * amp * 0.4, 0, -S(ph) * amp];
    o['ear_R_' + i] = [back + S(ph + 0.6) * amp * 0.4, 0, S(ph + 0.4) * amp];
  }
  return o;
};
// Alas (águila): wing_L_k / wing_R_k. spread = apertura hacia fuera (rad), flap = aleteo, speed = ciclos por clip.
const WING_N = Math.max(...Object.keys(bones).map((n) => { const m = n.match(/^wing_L_(\d+)$/); return m ? Number(m[1]) : 0; }), 0);
const wings = (t, spread, flap, speed, back = 0) => {
  const o = {};
  for (let k = 1; k <= WING_N; k++) {
    const ph = t * TAU * speed - k * 0.45;
    const a = spread * (k === 1 ? 1 : 0.55) + flap * S(ph) * (0.45 + 0.55 * k / WING_N);
    o['wing_L_' + k] = [-back * (k === 1 ? 1 : 0.4), 0, a];
    o['wing_R_' + k] = [-back * (k === 1 ? 1 : 0.4), 0, -a];
  }
  return o;
};
const WING_PROFILE = { idle: [0.05, 0.03, 1, 0], walk: [0.09, 0.05, 2, 0], run: [0.25, 0.1, 3, -0.25], swim: [0.4, 0.5, 2, -0.1], jump: [0.9, 0.3, 2, -0.2], power: [1.1, 0.5, 4, -0.1], cele: [0.8, 0.5, 3, 0] };
const merge = (...objs) => Object.assign({}, ...objs);

// REPOSO: respiración, cola que ondula y orejas que se mueven de vez en cuando
makeClip('idle', 2.4, (t) => ({
  dy: S(t * TAU) * 0.004,
  bones: merge(
    { spine: [S(t * TAU) * 0.02, 0, 0], chest: [S(t * TAU + 0.5) * 0.025, S(t * TAU) * 0.03, 0], head: [S(t * TAU * 2) * 0.03, S(t * TAU) * 0.08, 0] },
    { upper_arm_L: [0, 0, -0.1 + S(t * TAU) * 0.03], upper_arm_R: [0, 0, 0.1 - S(t * TAU) * 0.03], forearm_L: [-0.15, 0, 0], forearm_R: [-0.15, 0, 0] },
    tail(t, 0.28, 1),
    ears(t, 0.16 + (t > 0.55 && t < 0.7 ? 0.35 * S((t - 0.55) / 0.15 * Math.PI) : 0), 1),
  ),
}));

// pasos: piernas, brazos, torso y cola; intensidad `k`
const gait = (t, k, speed) => {
  const a = t * TAU;
  const swing = 0.55 * k, knee = 0.7 * k;
  const stepL = S(a), stepR = S(a + Math.PI);
  return {
    dy: Math.abs(S(a)) * 0.022 * k,
    bones: merge(
      {
        thigh_L: [-stepL * swing, 0, 0], thigh_R: [-stepR * swing, 0, 0],
        shin_L: [Math.max(0, S(a + 1.2)) * knee, 0, 0], shin_R: [Math.max(0, S(a + 1.2 + Math.PI)) * knee, 0, 0],
        foot_L: [stepL * 0.25 * k, 0, 0], foot_R: [stepR * 0.25 * k, 0, 0],
        upper_arm_L: [stepL * 0.6 * k, 0, -0.12], upper_arm_R: [stepR * 0.6 * k, 0, 0.12],
        forearm_L: [-0.3 - Math.max(0, -stepL) * 0.5 * k, 0, 0], forearm_R: [-0.3 - Math.max(0, -stepR) * 0.5 * k, 0, 0],
        spine: [0.06 * k, S(a) * 0.1 * k, 0], chest: [0.03 * k, -S(a) * 0.08 * k, 0], head: [-0.05 * k + S(a * 2) * 0.03, -S(a) * 0.05, 0],
      },
      tail(t, 0.3 * (0.6 + k * 0.6), speed * 2, 0.15 * k),
      ears(t, 0.18 + 0.1 * k, speed * 2, -0.1 * k),
    ),
  };
};
makeClip('walk', 1.0, (t) => gait(t, 1, 1));
makeClip('run', 0.6, (t) => gait(t, 1.9, 1));

// NADO: brazadas alternas, patada suave y cola amplia
makeClip('swim', 1.2, (t) => {
  const a = t * TAU;
  return {
    dy: S(a * 2) * 0.01,
    bones: merge(
      {
        upper_arm_L: [-0.9 + S(a) * 0.9, 0, -0.3], upper_arm_R: [-0.9 + S(a + Math.PI) * 0.9, 0, 0.3],
        forearm_L: [-0.5 + S(a + 0.8) * 0.4, 0, 0], forearm_R: [-0.5 + S(a + Math.PI + 0.8) * 0.4, 0, 0],
        thigh_L: [S(a * 2) * 0.35, 0, 0], thigh_R: [-S(a * 2) * 0.35, 0, 0], shin_L: [0.3 + S(a * 2 + 1) * 0.25, 0, 0], shin_R: [0.3 - S(a * 2 + 1) * 0.25, 0, 0],
        spine: [0, S(a) * 0.08, 0], head: [-0.2, 0, 0],
      },
      tail(t, 0.5, 2),
      ears(t, 0.12, 2, -0.5),
    ),
  };
});

// AIRE / SALTO: brazos abiertos, piernas recogidas, orejas y cola hacia atrás
makeClip('jump', 1.2, (t) => {
  const a = t * TAU;
  return {
    dy: 0,
    bones: merge(
      {
        thigh_L: [-0.7, 0, 0.1], thigh_R: [-0.45, 0, -0.1], shin_L: [1.1, 0, 0], shin_R: [0.8, 0, 0], foot_L: [0.3, 0, 0], foot_R: [0.3, 0, 0],
        upper_arm_L: [-1.9 + S(a) * 0.1, 0, -0.6], upper_arm_R: [-1.9 + S(a + 1) * 0.1, 0, 0.6], forearm_L: [-0.4, 0, 0], forearm_R: [-0.4, 0, 0],
        spine: [0.05, 0, 0], head: [-0.1, 0, 0],
      },
      tail(t, 0.15, 1, -0.5),
      ears(t, 0.1, 2, -0.7),
    ),
  };
});

// PODER: se agacha, levanta el bastón y lanza un gran aleteo de orejas
makeClip('power', 0.9, (t) => {
  const a = t * TAU;
  const wind = t < 0.35 ? t / 0.35 : 1 - (t - 0.35) / 0.65; // 0 → 1 → 0
  const k = Math.max(0, Math.min(1, wind));
  return {
    dy: -0.03 * k,
    bones: merge(
      {
        thigh_L: [-0.45 * k, 0, 0.1], thigh_R: [-0.45 * k, 0, -0.1], shin_L: [0.8 * k, 0, 0], shin_R: [0.8 * k, 0, 0],
        spine: [0.18 * k, 0, 0], chest: [-0.1 * k, S(a) * 0.1, 0],
        upper_arm_L: [-2.2 * k, 0, -0.4 * k], upper_arm_R: [-2.0 * k, 0, 0.4 * k], forearm_L: [-0.5 * k, 0, 0], forearm_R: [-0.5 * k, 0, 0],
        ...(bones.weapon ? { weapon: [-0.5 * k, 0, S(a * 3) * 0.2 * k] } : {}),
        head: [-0.18 * k, 0, 0],
      },
      tail(t, 0.4 * k, 2, 0.4 * k),
      ears(t, 0.2 + 0.7 * k, 5, 0),
    ),
  };
});

// CELEBRACIÓN: saltitos, brazos arriba que se agitan, cola y orejas muy contentas
makeClip('cele', 1.2, (t) => {
  const a = t * TAU;
  const hop = Math.abs(S(a * 1.5));
  return {
    dy: hop * 0.07,
    bones: merge(
      {
        thigh_L: [-hop * 0.35, 0, 0.1], thigh_R: [-hop * 0.35, 0, -0.1], shin_L: [hop * 0.6, 0, 0], shin_R: [hop * 0.6, 0, 0],
        upper_arm_L: [-2.6 + S(a * 3) * 0.3, 0, -0.5], upper_arm_R: [-2.6 + S(a * 3 + Math.PI) * 0.3, 0, 0.5], forearm_L: [-0.3, 0, 0], forearm_R: [-0.3, 0, 0],
        spine: [-0.08, S(a * 1.5) * 0.1, 0], head: [-0.12 + S(a * 3) * 0.05, S(a * 1.5) * 0.15, 0],
      },
      tail(t, 0.6, 3, 0.2),
      ears(t, 0.4, 3, 0),
    ),
  };
});

await io.write(output, doc);
console.log('animaciones:', root.listAnimations().map((x) => x.getName()).join(', '));
