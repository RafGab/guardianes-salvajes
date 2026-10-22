import * as THREE from 'three';
import { makeRng } from './utils.js';

// FONDO EN CAPAS: tres anillos de colinas / montañas redondeadas y nubes esponjosas alrededor del mapa.
// Cada capa se ve más clara y azulada con la distancia (perspectiva atmosférica) y se desplaza con parallax al mover
// la cámara, para dar profundidad como en un escenario 2D de capas. Son siluetas planas sin iluminación: legibles y bonitas.

// Paleta por escenario: [capa cercana, media, lejana]. `shape` = forma de las colinas.
const THEMES = {
  flood:     { shape: 'round', col: [0x4fb866, 0x78c9a2, 0xa8dcd2], cloud: 0xffffff },
  fire:      { shape: 'round', col: [0x8a8f3a, 0xd08a3c, 0xeab88a], cloud: 0xffe6cc },
  quake:     { shape: 'round', col: [0x6cbc68, 0xa4d49c, 0xd0e8d4], cloud: 0xffffff },
  volcano:   { shape: 'cone',  col: [0x7a5a7c, 0x9a6f92, 0xcfa0ae], cloud: 0xffd8d0, glow: true },
  hurricane: { shape: 'round', col: [0x3a9f9c, 0x66bfc2, 0xa6e0e4], cloud: 0xeaf6ff },
  sandstorm: { shape: 'dune',  col: [0xd8a042, 0xe9c476, 0xf4dcaa], cloud: 0xfff2d6 },
  ice:       { shape: 'peak',  col: [0x86b8e0, 0xb4d6f0, 0xe2f1fb], cloud: 0xffffff },
  drought:   { shape: 'round', col: [0xbf9238, 0xdbb862, 0xeed9a4], cloud: 0xfff4de },
  extreme:   { shape: 'round', col: [0x6a7bd0, 0x9a9ae2, 0xc8c2f2], cloud: 0xf4eeff },
};

// Capas: radio del anillo, nº de formas, tamaño base, factor de parallax (más lejos = sigue más a la cámara)
const LAYERS = [
  { r: 330, n: 22, size: 46, hMul: 0.95, follow: 0.82, y: -6 },
  { r: 470, n: 20, size: 70, hMul: 1.05, follow: 0.9, y: -10 },
  { r: 620, n: 18, size: 104, hMul: 1.15, follow: 0.96, y: -14 },
];

// Todas las formas son elipsoides redondeados (formas suaves, nada de aristas): solo cambia su proporción
const SHAPE = {
  round: { flat: 0.55, wide: 1.15 },
  dune: { flat: 0.28, wide: 1.7 },
  cone: { flat: 1.0, wide: 0.85 },   // volcanes: más altos y estrechos
  peak: { flat: 1.35, wide: 0.7 },   // montañas nevadas: altas, con la cumbre blanca
};

export function createBackdrop(scene, scenario, look) {
  const theme = THEMES[scenario] || THEMES.flood;
  const R = makeRng(901 + scenario.length * 17);
  const rng = R.next;
  const root = new THREE.Group();
  root.name = 'backdrop';
  const layers = [];
  const geo = new THREE.SphereGeometry(1, 20, 12);
  const sh = SHAPE[theme.shape] || SHAPE.round;
  LAYERS.forEach((L, li) => {
    const g = new THREE.Group();
    const col = theme.col[li];
    const mat = new THREE.MeshBasicMaterial({ color: col, fog: false });
    // la cima de las montañas de hielo y el cráter del volcán usan su propio color
    const capMat = new THREE.MeshBasicMaterial({ color: theme.shape === 'peak' ? 0xffffff : 0xffb070, fog: false });
    for (let i = 0; i < L.n; i++) {
      const a = (i / L.n) * Math.PI * 2 + rng() * 0.25;
      const r = L.r + (rng() - 0.5) * L.r * 0.12;
      const s = L.size * (0.7 + rng() * 0.8);
      const m = new THREE.Mesh(geo, mat);
      m.scale.set(s * sh.wide, s * L.hMul * sh.flat * (0.8 + rng() * 0.5), s * sh.wide);
      m.position.set(Math.cos(a) * r, L.y + m.scale.y * 0.4, Math.sin(a) * r);
      m.rotation.y = rng() * 6.28;
      g.add(m);
      if (theme.shape === 'peak') { // nieve en la cumbre
        const cap = new THREE.Mesh(geo, capMat);
        cap.scale.set(m.scale.x * 0.62, m.scale.y * 0.36, m.scale.z * 0.62);
        cap.position.set(m.position.x, m.position.y + m.scale.y * 0.72, m.position.z);
        cap.rotation.y = m.rotation.y;
        g.add(cap);
      }
    }
    if (theme.glow && li === 1) { // un volcán grande al fondo con el cráter encendido
      const v = new THREE.Mesh(geo, mat);
      v.scale.set(90, 120, 90);
      v.position.set(-60, L.y + 70, -L.r * 0.95);
      g.add(v);
      const crater = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 8), new THREE.MeshBasicMaterial({ color: 0xff7a2a, fog: false }));
      crater.scale.set(24, 8, 24);
      crater.position.set(-60, L.y + 170, -L.r * 0.95);
      g.add(crater);
    }
    root.add(g);
    layers.push({ g, follow: L.follow });
  });

  // nubes esponjosas: cúmulos de esferas con la base plana, entre las capas
  const cloudMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.cloud), fog: false, transparent: true, opacity: 0.96 });
  const shadeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.cloud).lerp(new THREE.Color(look.horizon), 0.35), fog: false, transparent: true, opacity: 0.96 });
  const sph = new THREE.SphereGeometry(1, 12, 8);
  const clouds = [];
  for (let i = 0; i < 16; i++) {
    const cg = new THREE.Group();
    const parts = 4 + Math.floor(rng() * 3);
    for (let k = 0; k < parts; k++) {
      const p = new THREE.Mesh(sph, k === 0 ? shadeMat : cloudMat);
      const s = 14 + rng() * 16;
      p.scale.set(s * 1.3, s * 0.7, s);
      p.position.set((k - parts / 2) * 18 + rng() * 6, k === 0 ? -3 : rng() * 7, rng() * 8);
      cg.add(p);
    }
    const a = rng() * Math.PI * 2, r = 380 + rng() * 260;
    cg.position.set(Math.cos(a) * r, 75 + rng() * 85, Math.sin(a) * r);
    cg.userData.drift = 0.6 + rng() * 1.2;
    root.add(cg);
    clouds.push(cg);
  }
  scene.add(root);

  return {
    root,
    // La cámara arrastra las capas con distinto factor (parallax) y las nubes avanzan despacio
    update(dt, camPos) {
      for (const L of layers) L.g.position.set(camPos.x * L.follow, 0, camPos.z * L.follow);
      for (const c of clouds) {
        c.position.x += c.userData.drift * dt;
        if (c.position.x - camPos.x * 0.94 > 700) c.position.x -= 1400;
      }
    },
  };
}
