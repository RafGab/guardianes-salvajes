import * as THREE from 'three';

// ESTILO VISUAL "DIBUJO ANIMADO" — una sola fuente para la dirección artística de los mapas:
// sombreado por bandas (toon), colores vivos y armoniosos, luz suave. Se aplica igual a todos los escenarios,
// de modo que cada región cambia de tema (bosque, desierto, nieve, volcán...) sin perder la identidad común.

export const TOON = {
  bands: [0.42, 0.68, 0.88, 1.0], // niveles de luz del sombreado por bandas (de sombra a luz)
  skySat: 1.28, skyLift: 0.07,    // viveza del cielo y la niebla
  lightSat: 1.12,                 // viveza de las luces
  fogMul: 0.85,                   // la niebla se aclara un poco: escenarios más legibles
  hemiMul: 1.1,                   // luz ambiental algo mayor = sombras más suaves
  gradeSat: 1.22, gradeCon: 1.0, gradeVig: 0.24, // corrección de color final (main.js)
};

let _grad = null;
export function toonGradient() {
  if (_grad) return _grad;
  const data = new Uint8Array(TOON.bands.length * 4);
  TOON.bands.forEach((b, i) => { const v = Math.round(b * 255); data.set([v, v, v, 255], i * 4); });
  _grad = new THREE.DataTexture(data, TOON.bands.length, 1, THREE.RGBAFormat);
  _grad.minFilter = _grad.magFilter = THREE.NearestFilter;
  _grad.generateMipmaps = false;
  _grad.needsUpdate = true;
  return _grad;
}

// Material con sombreado por bandas (acepta color, vertexColors, map, emissive...)
export function toonMat(params = {}) {
  return new THREE.MeshToonMaterial({ gradientMap: toonGradient(), ...params });
}

// Cielo de cada región: [cénit, horizonte]. Se mezcla con el cielo propio del escenario (SKY_MIX) para conservar su ambiente.
const SKY = {
  flood: [0x4a7fc8, 0xbcd8e8], fire: [0x7a3a6a, 0xff9a5a], quake: [0x4f9be0, 0xf7dcb0], volcano: [0x5a2f6e, 0xff8a6a],
  hurricane: [0x3a6fb0, 0xa8d4e4], sandstorm: [0x6aa8d8, 0xf6d89a], ice: [0x6aa6e8, 0xe4f2ff], drought: [0x5aa0e0, 0xfbe3a8], extreme: [0x5a4fc0, 0xd6a8f0],
};
const SKY_MIX = 0.6;

const _hsl = {};
function vivid(hex, sat, lift) {
  const c = new THREE.Color(hex);
  c.getHSL(_hsl);
  return c.setHSL(_hsl.h, Math.min(1, _hsl.s * sat), Math.min(0.94, _hsl.l + lift)).getHex();
}

// Devuelve una copia del `look` de un escenario con la paleta "dibujo animado" (más viva y luminosa)
export function cartoonLook(look, scenario) {
  const k = TOON;
  const sky = SKY[scenario];
  const mixTo = (hex, to) => (to === undefined ? hex : new THREE.Color(hex).lerp(new THREE.Color(to), SKY_MIX).getHex());
  const horizon = mixTo(look.horizon, sky && sky[1]);
  const zenith = mixTo(look.zenith, sky && sky[0]);
  return {
    ...look,
    horizon: vivid(horizon, k.skySat, k.skyLift),
    zenith: vivid(zenith, k.skySat * 1.05, k.skyLift * 1.5),
    fog: vivid(mixTo(look.fog, sky && sky[1]), k.skySat, k.skyLift),
    fogD: look.fogD * k.fogMul,
    hemi: [vivid(look.hemi[0], k.lightSat, 0.03), vivid(look.hemi[1], k.lightSat * 1.1, 0.07), look.hemi[2] * k.hemiMul],
    sun: [vivid(look.sun[0], k.lightSat, 0), look.sun[1]],
  };
}
