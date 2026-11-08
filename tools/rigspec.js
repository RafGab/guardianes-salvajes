// Estructura común de los esqueletos de los héroes (la usan tools/rig.mjs en Node y la vista de inspección en el navegador).
// Convención: el personaje mira a +Z, arriba es +Y y su izquierda es +X. Los huesos no tienen rotación de reposo.
// La especificación de cada personaje (JSON) solo da la POSICIÓN de cada articulación; la jerarquía sale de aquí.

const LR = (base, p) => ['L', 'R'].map((s) => [`${base}_${s}`, p(s)]);

// parent de cada hueso estándar (si existe en la especificación)
export function buildParents(joints, extra = []) {
  const has = (n) => n in joints;
  const P = {};
  const add = (n, p) => { if (has(n) && has(p)) P[n] = p; };
  add('spine', 'root'); add('chest', 'spine'); add('neck', 'chest'); add('head', 'neck'); add('head_end', 'head');
  for (const s of ['L', 'R']) {
    add(`clavicle_${s}`, 'chest'); add(`upper_arm_${s}`, `clavicle_${s}`); add(`forearm_${s}`, `upper_arm_${s}`);
    add(`hand_${s}`, `forearm_${s}`); add(`hand_end_${s}`, `hand_${s}`);
    add(`thigh_${s}`, 'root'); add(`shin_${s}`, `thigh_${s}`); add(`foot_${s}`, `shin_${s}`); add(`toe_${s}`, `foot_${s}`); add(`toe_end_${s}`, `toe_${s}`);
    // orejas: ear_L_1.. cuelgan de la cabeza
    for (let k = 1; k <= 6; k++) { add(`ear_${s}_${k}`, k === 1 ? 'head' : `ear_${s}_${k - 1}`); }
    for (let k = 1; k <= 6; k++) if (has(`ear_${s}_${k}`) && !has(`ear_${s}_${k + 1}`)) add(`ear_${s}_end`, `ear_${s}_${k}`);
    // alas (águila): wing_L_1 (hombro) ... wing_L_n, cuelgan del pecho
    for (let k = 1; k <= 8; k++) { add(`wing_${s}_${k}`, k === 1 ? 'chest' : `wing_${s}_${k - 1}`); }
    for (let k = 1; k <= 8; k++) if (has(`wing_${s}_${k}`) && !has(`wing_${s}_${k + 1}`)) add(`wing_${s}_end`, `wing_${s}_${k}`);
  }
  for (let k = 1; k <= 12; k++) add(`tail_${k}`, k === 1 ? 'root' : `tail_${k - 1}`);
  for (let k = 1; k <= 12; k++) if (has(`tail_${k}`) && !has(`tail_${k + 1}`)) add('tail_end', `tail_${k}`);
  for (const e of extra) if (has(e.name) && has(e.parent)) P[e.name] = e.parent;
  return P;
}

// Hueso hijo "principal" de cada hueso: define el segmento (articulación → articulación) usado para los pesos de piel
export function primaryChild(name, P) {
  const kids = Object.keys(P).filter((k) => P[k] === name);
  if (!kids.length) return null;
  const prefer = { root: 'spine', spine: 'chest', chest: 'neck', neck: 'head', head: 'head_end' };
  if (prefer[name] && kids.includes(prefer[name])) return prefer[name];
  if (name.startsWith('clavicle')) return kids[0];
  return kids[0];
}

// lado de un hueso: +1 izquierda (+X), -1 derecha (-X), 0 centro
export const sideOf = (n) => (/_L(_|$)/.test(n) ? 1 : /_R(_|$)/.test(n) ? -1 : 0);

// grupo del hueso (para reglas de peso)
export function groupOf(n) {
  if (/^thigh|^shin|^foot|^toe/.test(n)) return 'leg';
  if (/^clavicle|^upper_arm|^forearm|^hand/.test(n)) return 'arm';
  if (/^tail/.test(n)) return 'tail';
  if (/^ear/.test(n)) return 'ear';
  if (/^wing/.test(n)) return 'wing';
  if (/^(root|spine|chest|neck|head)/.test(n)) return 'core';
  return 'extra';
}
