// Configuración global mutable y función de terreno conmutable (cada escenario define la suya)
export const CFG = {
  P: 32,
  GRID: 4,
  BLOCK_HALF: 11,
  CITY_HALF: 64,
  SAFE: { x: 0, z: -96, y: 10.2, r: 8 },
  START: { x: 0, z: 62 },
  GROUND_BLOCK: 0.16,
  MAP: { x0: -128, z0: -128, size: 256, n: 256 },
  MISSION_TIME: 360,
  WATER0: 0.1,
  WATER_BASE: 6.2,
  SURGE: 1.25,
  SURGE_T: 120,
};

let _terrain = () => 0;
export function terrainH(x, z) {
  return _terrain(x, z);
}
export function setTerrain(fn) {
  _terrain = fn;
}
