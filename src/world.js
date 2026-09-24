import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRng, clamp, damp, smoothstep, lerp, TAU } from './utils.js';
import { CFG, terrainH, buildCity, buildTerrain, bakeHeightMap, paintGround, M4 } from './city.js';
import { createSky, createWater, createRain, Ripples, createBirds } from './env.js';

const unitBox = new THREE.BoxGeometry(1, 1, 1);
unitBox.translate(0, 0.5, 0);
const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 12);
unitCyl.translate(0, 0.5, 0);

function mergeParts(parts) {
  const geos = parts.map(([geo, matrix, color]) => {
    const g = geo.clone();
    g.applyMatrix4(matrix);
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
  });
  return mergeGeometries(geos, false);
}

function carGeometry(color) {
  const wheels = [[-1.3, 0.34, -0.92], [1.3, 0.34, -0.92], [-1.3, 0.34, 0.92], [1.3, 0.34, 0.92]];
  const parts = [
    [unitBox, M4(0, 0.2, 0, 4.2, 0.72, 1.9), color],
    [unitBox, M4(-0.15, 0.85, 0, 2.3, 0.62, 1.72), 0x2a3846],
    [unitBox, M4(-0.15, 1.42, 0, 2.2, 0.1, 1.66), color],
    [unitBox, M4(2.11, 0.42, -0.6, 0.06, 0.16, 0.34), new THREE.Color(0xfff2c0).multiplyScalar(2.5)],
    [unitBox, M4(2.11, 0.42, 0.6, 0.06, 0.16, 0.34), new THREE.Color(0xfff2c0).multiplyScalar(2.5)],
    [unitBox, M4(-2.11, 0.42, -0.6, 0.06, 0.16, 0.34), new THREE.Color(0xff2a1a)],
    [unitBox, M4(-2.11, 0.42, 0.6, 0.06, 0.16, 0.34), new THREE.Color(0xff2a1a)],
  ];
  for (const [x, y, z] of wheels) parts.push([unitCyl, M4(x, y - 0.34, z, 0.34, 0.26, 0.34, 0, Math.PI / 2), 0x151515]);
  return mergeParts(parts);
}

function busGeometry() {
  const parts = [
    [unitBox, M4(0, 0.35, 0, 9.4, 2.5, 2.6), 0xe0a020],
    [unitBox, M4(0, 1.5, 0, 9.42, 0.9, 2.62), 0x243848],
    [unitBox, M4(0, 2.85, 0, 9.2, 0.15, 2.4), 0xc8901a],
    [unitBox, M4(4.7, 0.6, 0, 0.06, 0.4, 2.0), new THREE.Color(0xfff2c0).multiplyScalar(2.5)],
  ];
  for (const x of [-3, 3]) for (const z of [-1.2, 1.2]) parts.push([unitCyl, M4(x, 0, z, 0.45, 0.32, 0.45, 0, Math.PI / 2), 0x151515]);
  return mergeParts(parts);
}

function raftGeometry() {
  const parts = [[unitBox, M4(0, 0.1, 0, 3.2, 0.2, 3.0), 0x9a7048]];
  for (let i = -1; i <= 1; i++) parts.push([unitBox, M4(i * 1.0, 0.2, 0, 0.9, 0.08, 3.06), 0x7a5230]);
  for (const x of [-1.4, 1.4]) parts.push([unitCyl, M4(x, -0.2, 0, 0.42, 3.0, 0.42, 0, 0, Math.PI / 2), 0x3a6ea8]);
  return mergeParts(parts);
}

function crateGeometry() {
  return mergeParts([
    [unitBox, M4(0, 0, 0, 1.1, 1.1, 1.1), 0xa9793f],
    [unitBox, M4(0, 0.5, 0, 1.16, 0.1, 1.16), 0x6a4a2a],
    [unitBox, M4(0, 0, 0, 1.16, 0.1, 1.16), 0x6a4a2a],
  ]);
}
function barrelGeometry(color) {
  return mergeParts([
    [unitCyl, M4(0, 0, 0, 0.32, 0.9, 0.32), color],
    [unitCyl, M4(0, 0.2, 0, 0.34, 0.06, 0.34), 0x2a2a2a],
    [unitCyl, M4(0, 0.6, 0, 0.34, 0.06, 0.34), 0x2a2a2a],
  ]);
}
function logGeometry() {
  return mergeParts([[unitCyl, M4(0, 0, 0, 0.26, 3.2, 0.26, 0, 0, Math.PI / 2), 0x6a4a30], [unitCyl, M4(1.62, -0.05, 0, 0.27, 0.05, 0.27, 0, 0, Math.PI / 2), 0xb08a5a]]);
}

export function createWorld(scene, renderer, { quality = 'high' } = {}) {
  const W = { time: 0, waterY: CFG.WATER0, quality };
  const rng = makeRng(555);

  /* ---------- cielo, niebla, luces ---------- */
  const sky = createSky(scene);
  W.sky = sky;
  scene.fog = new THREE.FogExp2(0x5f7085, 0.0065);
  const hemi = new THREE.HemisphereLight(0x9fb4cc, 0x3c3a36, 1.25);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xdfe6f2, 2.3);
  sun.position.set(60, 90, 40);
  sun.castShadow = true;
  const ss = quality === 'high' ? 2048 : 1024;
  sun.shadow.mapSize.set(ss, ss);
  const sc = sun.shadow.camera;
  sc.left = -48; sc.right = 48; sc.top = 48; sc.bottom = -48; sc.near = 10; sc.far = 260;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.05;
  scene.add(sun);
  scene.add(sun.target);
  W.hemi = hemi;
  W.sun = sun;
  const sunOffset = new THREE.Vector3(60, 90, 40);

  /* ---------- ciudad y terreno ---------- */
  const city = buildCity(scene, { quality });
  W.city = city;
  const ground = paintGround(city.parkBlocks, city.plazaBlocks);
  buildTerrain(scene, ground.tex);
  W.groundCanvas = ground.canvas;

  const treeTime = { value: 0 };
  const mats = {
    facade: new THREE.MeshStandardMaterial({ map: city.facade.map, emissiveMap: city.facade.em, emissive: 0xffffff, emissiveIntensity: 1.6, vertexColors: true, roughness: 0.88 }),
    flat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05 }),
    trees: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
  };
  mats.trees.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = treeTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float kk = clamp((transformed.y - 2.5) / 8.0, 0.0, 1.0);
        transformed.x += sin(uTime * 1.5 + transformed.z * 0.15 + transformed.x * 0.1) * 0.16 * kk * kk;
        transformed.z += cos(uTime * 1.2 + transformed.x * 0.13) * 0.12 * kk * kk;`);
  };
  city.batch.build(scene, mats, { glow: { cast: false, receive: false }, trees: { receive: false } });

  const hm = bakeHeightMap(city.buildings);
  W.heightData = hm.data;

  /* ---------- agua, lluvia, ondas, pájaros ---------- */
  const water = createWater(scene, hm.tex, { x0: CFG.MAP.x0, z0: CFG.MAP.z0, size: CFG.MAP.size });
  W.water = water;
  const rain = createRain(scene, quality === 'high' ? 4200 : 2200);
  W.rain = rain;
  W.ripples = new Ripples(scene, 110);
  const birds = createBirds(scene, 12);

  /* ---------- rejilla espacial de sólidos ---------- */
  const CELL = 8;
  const GN = 256 / CELL;
  const grid = Array.from({ length: GN * GN }, () => []);
  const cellRange = (s) => [
    clamp(Math.floor((s.x0 + 128) / CELL), 0, GN - 1), clamp(Math.floor((s.x1 + 128) / CELL), 0, GN - 1),
    clamp(Math.floor((s.z0 + 128) / CELL), 0, GN - 1), clamp(Math.floor((s.z1 + 128) / CELL), 0, GN - 1),
  ];
  for (const s of city.solids) {
    const [i0, i1, j0, j1] = cellRange(s);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) grid[j * GN + i].push(s);
  }
  W.dynSolids = [];
  let stamp = 0;
  W.solidsNear = (x0, x1, z0, z1, out) => {
    out.length = 0;
    stamp++;
    const i0 = clamp(Math.floor((x0 + 128) / CELL), 0, GN - 1), i1 = clamp(Math.floor((x1 + 128) / CELL), 0, GN - 1);
    const j0 = clamp(Math.floor((z0 + 128) / CELL), 0, GN - 1), j1 = clamp(Math.floor((z1 + 128) / CELL), 0, GN - 1);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const cell = grid[j * GN + i];
        for (let k = 0; k < cell.length; k++) {
          const s = cell[k];
          if (s._q === stamp) continue;
          s._q = stamp;
          if (s.x1 > x0 && s.x0 < x1 && s.z1 > z0 && s.z0 < z1) out.push(s);
        }
      }
    }
    for (const s of W.dynSolids) if (s.x1 > x0 && s.x0 < x1 && s.z1 > z0 && s.z0 < z1) out.push(s);
    return out;
  };
  W.groundY = terrainH;

  /* ---------- corriente ---------- */
  const flowOut = { x: 0, z: 0 };
  W.missionT = 0;
  W.flowAt = (x, z) => {
    const inCity = Math.abs(x) < 72 && Math.abs(z) < 72;
    let fx = 0, fz = 0;
    if (inCity) {
      const mz = ((((z + 16) % 32) + 32) % 32) - 16;
      const mx = ((((x + 16) % 32) + 32) % 32) - 16;
      const wx = smoothstep(7, 3, Math.abs(mz));
      const wz = smoothstep(7, 3, Math.abs(mx));
      fx = 1.35 * wx;
      fz = 0.6 * wz;
    }
    const gain = 0.5 + 0.5 * clamp(W.waterY / 3, 0, 1) + 0.4 * smoothstep(CFG.SURGE_T, CFG.SURGE_T + 7, W.missionT);
    flowOut.x = fx * gain;
    flowOut.z = fz * gain;
    return flowOut;
  };

  /* ---------- cuerpos dinámicos (coches, balsa, escombros) ---------- */
  const bodies = [];
  W.bodies = bodies;
  const restRoad = -0.02;
  function addBody(o) {
    const b = Object.assign({ vx: 0, vz: 0, y: o.restY ?? restRoad, restY: o.restY ?? restRoad, phase: rng.range(0, TAU), drift: 0.7, floating: false, solid: null, wobble: 0.03 }, o);
    b.x0 = b.x; b.z0 = b.z;
    b.px = b.x; b.py = b.y; b.pz = b.z;
    b.mesh.position.set(b.x, b.y, b.z);
    scene.add(b.mesh);
    if (b.hx) {
      b.solid = { x0: b.x - b.hx, x1: b.x + b.hx, y0: b.y, y1: b.y + b.h, z0: b.z - b.hz, z1: b.z + b.hz, tag: b.kind, dyn: true, dx: 0, dy: 0, dz: 0, _q: 0, body: b };
      W.dynSolids.push(b.solid);
    }
    bodies.push(b);
    return b;
  }
  const carColors = [0xc0392b, 0x2e86c1, 0xecf0f1, 0x27ae60, 0xf1c40f, 0x7f8c8d, 0x8e44ad, 0xe67e22, 0x1abc9c];
  const carGeoCache = new Map();
  function makeCar(x, z, axis, color) {
    let geo = carGeoCache.get(color);
    if (!geo) carGeoCache.set(color, (geo = carGeometry(color)));
    const mesh = new THREE.Mesh(geo, mats.flat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.rotation.y = axis === 'z' ? Math.PI / 2 : 0;
    return addBody({ kind: 'car', mesh, x, z, axis, hx: axis === 'x' ? 2.1 : 0.95, hz: axis === 'x' ? 0.95 : 2.1, h: 1.5, draft: 0.5, drift: 0.55 });
  }
  // coches aparcados en las calles
  const lines = [-32, 0, 32];
  for (const line of lines) {
    for (let t = -56; t <= 56; t += 9) {
      const tl = ((((t + 16) % 32) + 32) % 32) - 16;
      if (Math.abs(tl) < 8.5) continue;
      for (const side of [-1, 1]) {
        if (!rng.chance(0.28)) continue;
        const off = 3.4 * side;
        // calle E-O
        makeCar(t + rng.range(-1.5, 1.5), line + off, 'x', rng.pick(carColors));
        // calle N-S
        if (rng.chance(0.7)) makeCar(line + off, t + rng.range(-1.5, 1.5), 'z', rng.pick(carColors));
      }
    }
  }
  // coches bloqueados por edificios se retiran para no solapar
  for (let i = bodies.length - 1; i >= 0; i--) {
    const b = bodies[i];
    const near = [];
    W.solidsNear(b.x - b.hx, b.x + b.hx, b.z - b.hz, b.z + b.hz, near);
    const clash = near.some((s) => !s.dyn && s.tag !== 'tree' ? true : false) || Math.hypot(b.x - CFG.START.x, b.z - CFG.START.z) < 9;
    if (clash) {
      scene.remove(b.mesh);
      W.dynSolids.splice(W.dynSolids.indexOf(b.solid), 1);
      bodies.splice(i, 1);
    }
  }
  // entre coches también
  for (let i = bodies.length - 1; i >= 0; i--) {
    const a = bodies[i];
    for (let j = 0; j < i; j++) {
      const c = bodies[j];
      if (Math.abs(a.x - c.x) < a.hx + c.hx + 0.3 && Math.abs(a.z - c.z) < a.hz + c.hz + 0.3) {
        scene.remove(a.mesh);
        W.dynSolids.splice(W.dynSolids.indexOf(a.solid), 1);
        bodies.splice(i, 1);
        break;
      }
    }
  }

  // Coches con rescatables
  const carDog1 = makeCar(3.4, 44, 'z', 0xc0392b);
  const carDog2 = makeCar(20, -35.4, 'x', 0x2e86c1);
  // autobús
  const busMesh = new THREE.Mesh(busGeometry(), mats.flat);
  busMesh.castShadow = true;
  busMesh.receiveShadow = true;
  busMesh.rotation.y = Math.PI / 2;
  const bus = addBody({ kind: 'bus', mesh: busMesh, x: -35.2, z: -22, hx: 1.3, hz: 4.7, h: 3.0, draft: 0.8, drift: 0.3 });
  // balsa
  const raftMesh = new THREE.Mesh(raftGeometry(), mats.flat);
  raftMesh.castShadow = true;
  const raft = addBody({ kind: 'raft', mesh: raftMesh, x: -20, z: 0.6, hx: 1.6, hz: 1.5, h: 0.3, draft: 0.05, drift: 0.55, wobble: 0.05 });

  // escombros flotantes
  const barrelCols = [0xc0392b, 0x2e86c1, 0x27ae60, 0xd4a017];
  const streetPos = () => {
    const line = rng.pick([-32, 0, 32, -64, 64]);
    const t = rng.range(-60, 60);
    return rng.chance(0.5) ? [t, line + rng.range(-3, 3)] : [line + rng.range(-3, 3), t];
  };
  for (let i = 0; i < 20; i++) {
    const [x, z] = streetPos();
    const m = new THREE.Mesh(barrelGeometry(rng.pick(barrelCols)), mats.flat);
    m.castShadow = true;
    addBody({ kind: 'barrel', mesh: m, x, z, draft: 0.3, pushR: 0.5, drift: 0.9, wobble: 0.12 });
  }
  for (let i = 0; i < 8; i++) {
    const [x, z] = streetPos();
    const m = new THREE.Mesh(logGeometry(), mats.flat);
    m.castShadow = true;
    m.rotation.y = rng.range(0, TAU);
    addBody({ kind: 'log', mesh: m, x, z, draft: 0.22, pushR: 1.2, drift: 1.0, wobble: 0.06 });
  }
  const crateGeo = crateGeometry();
  for (let i = 0; i < 10; i++) {
    const [x, z] = streetPos();
    const m = new THREE.Mesh(crateGeo, mats.flat);
    m.castShadow = true;
    addBody({ kind: 'crate', mesh: m, x, z, hx: 0.58, hz: 0.58, h: 1.1, draft: 0.5, drift: 0.8, wobble: 0.05 });
  }
  W.pushables = bodies.filter((b) => b.pushR);

  /* ---------- puntos de aparición de rescatables ---------- */
  const R = city.roofs;
  const findRoof = (kind, bi, bj) => R.find((r) => r.kind === kind && r.b.bi === bi && r.b.bj === bj);
  const slots = [];
  const roofSlot = (kind, r, dx = 0, dz = 0, hard = false) => {
    if (r) slots.push({ kind, x: r.x + dx, y: r.roofY, z: r.z + dz, hard, where: 'tejado' });
  };
  const low3 = R.filter((r) => r.kind === 'low3' && r.b.bi === 1 && r.b.bj === 3);
  const porch = city.porches.find((p) => p.b.bi === 1 && p.b.bj === 3) || city.porches[0];
  const childRoof = low3.find((r) => !porch || r.b !== porch.b) || low3[0];
  slots.push({ kind: 'perro', body: carDog1, ly: 1.5, where: 'coche' });
  if (porch) slots.push({ kind: 'anciano', x: porch.x, y: porch.y, z: porch.z, where: 'porche' });
  roofSlot('nino', childRoof, 0, 0);
  roofSlot('gato', findRoof('low6', 2, 2) || R.find((r) => r.kind === 'low6'), 0, 0);
  slots.push({ kind: 'hombre', body: raft, ly: 0.28, where: 'balsa' });
  slots.push({ kind: 'ciervo', body: bus, ly: 3.0, where: 'autobús' });
  roofSlot('mujer', findRoof('mid9', 2, 1) || R.find((r) => r.kind === 'mid9'), 0, 0);
  slots.push({ kind: 'perro', body: carDog2, ly: 1.5, where: 'coche' });
  roofSlot('nino', findRoof('mid12', 0, 0) || R.find((r) => r.kind === 'mid12'), 0, 0, true);
  const lands = city.landings.filter((l) => l.b.bi === 3 && l.b.bj === 1);
  const land = lands[Math.min(3, lands.length - 1)] || city.landings[0];
  if (land) slots.push({ kind: 'mujer', x: land.x, y: land.top, z: land.z, where: 'escalera de emergencia', hard: true });
  W.victimSlots = slots;

  /* ---------- pilares de roca y placas de hielo ---------- */
  const pillars = [];
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x6a655c, roughness: 0.9, flatShading: true });
  const crystalM = new THREE.MeshStandardMaterial({ color: 0x19e070, emissive: 0x19e070, emissiveIntensity: 1.1, roughness: 0.2, flatShading: true });
  W.spawnPillar = (x, z, standingY) => {
    const base = Math.min(terrainH(x, z), standingY) - 0.4;
    const topY = Math.max(standingY + 2.4, W.waterY + 2.0);
    const g = new THREE.Group();
    g.position.set(x, base, z);
    const rock = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.45, 1, 7), rockMat);
    rock.castShadow = true;
    rock.receiveShadow = true;
    rock.geometry.translate(0, 0.5, 0);
    g.add(rock);
    const crystals = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.7, 5), crystalM);
      const a = i * 1.3;
      c.position.set(Math.cos(a) * 0.55, 0.2, Math.sin(a) * 0.55);
      c.rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4);
      crystals.add(c);
    }
    g.add(crystals);
    scene.add(g);
    const solid = { x0: x - 1.15, x1: x + 1.15, y0: base - 1, y1: base + 0.1, z0: z - 1.15, z1: z + 1.15, tag: 'pillar', dyn: true, dx: 0, dy: 0, dz: 0, _q: 0 };
    W.dynSolids.push(solid);
    const p = { g, rock, crystals, solid, base, height: 0.1, target: topY - base, life: 26, sinking: false };
    pillars.push(p);
    if (pillars.length > 3) removePillar(pillars[0]);
    return p;
  };
  function removePillar(p) {
    scene.remove(p.g);
    const i = W.dynSolids.indexOf(p.solid);
    if (i >= 0) W.dynSolids.splice(i, 1);
    const k = pillars.indexOf(p);
    if (k >= 0) pillars.splice(k, 1);
  }
  const iceSheets = [];
  const iceTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(128, 128, 10, 128, 128, 128);
    gr.addColorStop(0, '#f2fbff');
    gr.addColorStop(1, '#a8dcf4');
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(255,255,255,.7)';
    for (let i = 0; i < 40; i++) {
      g.lineWidth = 1 + Math.random() * 1.5;
      g.beginPath();
      let x = 128, y = 128;
      g.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += (Math.random() - 0.5) * 70;
        y += (Math.random() - 0.5) * 70;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  W.spawnIce = (x, z) => {
    const mat = new THREE.MeshPhysicalMaterial({ map: iceTex, color: 0xcfeeff, emissive: 0x5ab8ff, emissiveIntensity: 0.35, roughness: 0.15, metalness: 0.05, transparent: true, opacity: 0.92, clearcoat: 1 });
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(4.9, 4.9, 0.7, 8), mat);
    mesh.rotation.y = Math.PI / 8;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const g = new THREE.Group();
    g.add(mesh);
    for (let i = 0; i < 8; i++) {
      const s = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.1, 5), mat);
      const a = i * (TAU / 8) + 0.3;
      s.position.set(Math.cos(a) * 4.1, 0.6, Math.sin(a) * 4.1);
      s.rotation.z = Math.cos(a) * 0.25;
      s.rotation.x = -Math.sin(a) * 0.25;
      g.add(s);
    }
    const top = W.waterY + 0.08;
    g.position.set(x, top - 0.35, z);
    scene.add(g);
    const solid = { x0: x - 4.1, x1: x + 4.1, y0: top - 0.9, y1: top, z0: z - 4.1, z1: z + 4.1, tag: 'ice', dyn: true, dx: 0, dy: 0, dz: 0, _q: 0 };
    W.dynSolids.push(solid);
    const s = { g, mat, solid, top, life: 20, x, z };
    iceSheets.push(s);
    if (iceSheets.length > 3) removeIce(iceSheets[0]);
    return s;
  };
  function removeIce(s) {
    scene.remove(s.g);
    const i = W.dynSolids.indexOf(s.solid);
    if (i >= 0) W.dynSolids.splice(i, 1);
    const k = iceSheets.indexOf(s);
    if (k >= 0) iceSheets.splice(k, 1);
  }

  /* ---------- nivel del agua ---------- */
  W.levelAt = (t) => {
    const k = clamp(t / CFG.MISSION_TIME, 0, 1);
    const base = CFG.WATER0 + (CFG.WATER_BASE - CFG.WATER0) * Math.pow(k, 1.2);
    return base + CFG.SURGE * smoothstep(CFG.SURGE_T, CFG.SURGE_T + 7, t);
  };

  /* ---------- relámpagos ---------- */
  let lightningTimer = 12;
  let flash = 0;
  W.onThunder = null;
  W.triggerLightning = () => {
    flash = 1;
    if (W.onThunder) setTimeout(() => W.onThunder(), 300 + Math.random() * 900);
  };
  W.stormIntensity = 0.5;

  /* ---------- reinicio ---------- */
  W.reset = () => {
    for (const p of [...pillars]) removePillar(p);
    for (const s of [...iceSheets]) removeIce(s);
    for (const b of bodies) {
      b.x = b.x0; b.z = b.z0; b.y = b.restY; b.vx = b.vz = 0; b.floating = false;
      b.px = b.x; b.py = b.y; b.pz = b.z;
      b.mesh.position.set(b.x, b.y, b.z);
      b.mesh.rotation.z = 0;
      b.mesh.rotation.x = 0;
    }
    W.missionT = 0;
    W.waterY = W.levelAt(0);
    lightningTimer = 12;
    flash = 0;
  };

  /* ---------- actualización ---------- */
  const tmpBox = [];
  function bodyBlocked(b, nx, nz) {
    const near = W.solidsNear(nx - b.hx, nx + b.hx, nz - b.hz, nz + b.hz, tmpBox);
    for (const s of near) {
      if (s.dyn || s.tag === 'tree') continue;
      if (s.y1 > b.y + 0.1 && s.y0 < b.y + (b.h || 1)) return true;
    }
    return false;
  }
  W.update = (dt, t, camPos, playerPos, missionT, gameOn) => {
    W.time = t;
    W.missionT = missionT;
    W.waterY = W.levelAt(missionT) + Math.sin(t * 0.7) * 0.02;
    const wu = water.uniforms;
    wu.uTime.value = t;
    water.mesh.position.y = W.waterY;
    wu.uLevel.value = W.waterY;
    wu.uFlow.value = 0.5 + 0.5 * clamp(W.waterY / 3, 0, 1);
    sky.mat.uniforms.uTime.value = t;
    treeTime.value = t;
    const ru = rain.uniforms;
    ru.uTime.value = t;
    ru.uCam.value.copy(camPos);
    birds.update(t);

    // relámpagos
    lightningTimer -= dt;
    if (lightningTimer <= 0 && gameOn) {
      W.triggerLightning();
      lightningTimer = rng.range(9, 22) / (0.6 + W.stormIntensity);
    }
    flash = Math.max(0, flash - dt * 3.2);
    const fl = flash > 0.7 ? 1 : flash > 0.45 ? 0.25 : flash > 0.3 ? 0.9 : flash * 0.5;
    sky.mat.uniforms.uFlash.value = fl;
    wu.uFlash.value = fl;
    hemi.intensity = 1.25 + fl * 2.2;
    ru.uAlpha.value = 0.30 + fl * 0.3;

    // cuerpos flotantes
    for (const b of bodies) {
      const target = W.waterY - b.draft;
      const should = target > b.restY + 0.03;
      if (should && !b.floating && target > b.restY + 0.12) b.floating = true;
      if (!should) b.floating = false;
      const ny = b.floating ? target + Math.sin(t * 1.7 + b.phase) * 0.05 : b.restY;
      b.y = damp(b.y, ny, b.floating ? 3.5 : 10, dt);
      if (b.floating) {
        const f = W.flowAt(b.x, b.z);
        b.vx = damp(b.vx, f.x * b.drift + Math.sin(t * 0.4 + b.phase) * 0.15, 0.7, dt);
        b.vz = damp(b.vz, f.z * b.drift + Math.cos(t * 0.35 + b.phase) * 0.15, 0.7, dt);
        const nx = b.x + b.vx * dt, nz = b.z + b.vz * dt;
        if (b.hx) {
          if (!bodyBlocked(b, nx, b.z)) b.x = nx; else b.vx *= -0.25;
          if (!bodyBlocked(b, b.x, nz)) b.z = nz; else b.vz *= -0.25;
        } else {
          b.x = nx; b.z = nz;
        }
        if (Math.abs(b.x) > 100) { b.x = clamp(b.x, -100, 100); b.vx = 0; }
        if (Math.abs(b.z) > 100) { b.z = clamp(b.z, -100, 100); b.vz = 0; }
        b.mesh.rotation.z = Math.sin(t * 1.3 + b.phase) * b.wobble;
        b.mesh.rotation.x = Math.cos(t * 1.1 + b.phase * 2) * b.wobble * 0.8;
        if (b.kind === 'barrel' || b.kind === 'log') b.mesh.rotation.y += dt * 0.3 * Math.sin(b.phase);
      } else {
        b.mesh.rotation.z = damp(b.mesh.rotation.z, 0, 6, dt);
        b.mesh.rotation.x = damp(b.mesh.rotation.x, 0, 6, dt);
      }
      b.mesh.position.set(b.x, b.y, b.z);
      if (b.solid) {
        const s = b.solid;
        s.dx = b.x - b.px; s.dy = b.y - b.py; s.dz = b.z - b.pz;
        s.x0 = b.x - b.hx; s.x1 = b.x + b.hx; s.z0 = b.z - b.hz; s.z1 = b.z + b.hz;
        s.y0 = b.y; s.y1 = b.y + b.h;
      }
      b.px = b.x; b.py = b.y; b.pz = b.z;
    }

    // pilares
    for (let i = pillars.length - 1; i >= 0; i--) {
      const p = pillars[i];
      const prev = p.height;
      p.life -= dt;
      if (p.life <= 0) p.sinking = true;
      if (!p.sinking) p.height = Math.min(p.target, p.height + dt * (p.height < p.target ? 12 : 0));
      else p.height -= dt * 3;
      if (p.height <= 0.05 && p.sinking) { removePillar(p); continue; }
      p.solid.dy = p.height - prev;
      p.solid.y1 = p.base + p.height;
      p.rock.scale.set(1, p.height, 1);
      p.crystals.position.y = p.height;
    }
    // hielo (flota con el agua)
    for (let i = iceSheets.length - 1; i >= 0; i--) {
      const s = iceSheets[i];
      s.life -= dt;
      const newTop = W.waterY + 0.08 - (s.life < 3 ? (3 - s.life) * 0.25 : 0);
      s.solid.dy = newTop - s.top;
      s.top = newTop;
      s.solid.y1 = newTop;
      s.solid.y0 = newTop - 0.9;
      s.g.position.y = newTop - 0.35;
      s.mat.opacity = s.life < 3 ? 0.35 + 0.57 * (s.life / 3) : 0.92;
      if (s.life <= 0) removeIce(s);
    }
    // sol siguiendo al jugador
    if (playerPos) {
      sun.target.position.set(playerPos.x, playerPos.y, playerPos.z);
      sun.position.set(playerPos.x + sunOffset.x, playerPos.y + sunOffset.y, playerPos.z + sunOffset.z);
    }
    // refugio
    const so = city.safeObj;
    so.rotor.rotation.y += dt * 4 * (0.25 + 0.75 * Math.abs(Math.sin(t * 0.2)));
    so.tailRotor.rotation.x += dt * 12;
    so.beaconMat.uniforms.uTime.value = t;
    so.ring.scale.setScalar(1 + Math.sin(t * 2) * 0.03);
    const fp = so.flag.geometry.attributes.position;
    for (let i = 0; i < fp.count; i++) {
      const x = fp.getX(i);
      fp.setZ(i, Math.sin(x * 2.2 + t * 4) * 0.12 * (x + 1.3) / 2.6);
    }
    fp.needsUpdate = true;
    W.ripples.update(dt);
  };

  W.pushAt = (px, pz, r, out) => {
    out.x = 0; out.z = 0;
    for (const b of W.pushables) {
      if (!b.floating) continue;
      const dx = px - b.x, dz = pz - b.z;
      const rr = r + b.pushR;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && Math.abs(W.waterY - b.draft - 0) > -1) {
        const d = Math.sqrt(d2) || 0.01;
        out.x += (dx / d) * (rr - d) * 3 + b.vx * 0.5;
        out.z += (dz / d) * (rr - d) * 3 + b.vz * 0.5;
        out.hit = b;
      }
    }
    return out;
  };

  W.safe = CFG.SAFE;
  W.signs = city.signs;
  W.sunLightRef = sun;
  return W;
}
