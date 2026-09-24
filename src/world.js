import * as THREE from 'three';
import { makeRng, clamp, damp, smoothstep, TAU } from './utils.js';
import { CFG, terrainH } from './terrain.js';
import { buildTerrain, bakeHeightMap } from './city.js';
import { createKit } from './kit.js';
import { createSky, createWater, createRain, Ripples, createBirds } from './env.js';
import { carGeometry } from './bodies.js';
import { IS_TOUCH } from './platform.js';
import { SCENARIOS } from './scenarios/index.js';
import { generateRescues, computeReach } from './spawn.js';

export function createWorld(scene, renderer, { quality = 'high', scenario = 'flood' } = {}) {
  const def = SCENARIOS[scenario] || SCENARIOS.flood;
  const mobile = IS_TOUCH;
  const K = createKit({ scene, seed: def.seed || 555, mobile });
  const sc = def.build(K, { scene, quality, mobile });
  const look = sc.look;
  const wcfg = sc.water || { mode: 'none' };
  const hasWater = wcfg.mode !== 'none';
  const W = { time: 0, waterY: hasWater ? wcfg.base : -50, quality, scenario, hasWater, look, fogBase: look.fogD, sc, K, duration: 360, mobile, missionT: 0 };
  const rng = makeRng(555);
  W.rng = rng;

  /* ---------- cielo, niebla, luces ---------- */
  const sky = createSky(scene);
  W.sky = sky;
  const su = sky.mat.uniforms;
  su.uHorizon.value.set(look.horizon);
  su.uZenith.value.set(look.zenith);
  su.uCloudLo.value.set(...look.cloudLo);
  su.uCloudHi.value.set(...look.cloudHi);
  su.uCover.value = look.cover;
  scene.fog = new THREE.FogExp2(look.fog, look.fogD);
  const hemi = new THREE.HemisphereLight(look.hemi[0], look.hemi[1], look.hemi[2]);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(look.sun[0], look.sun[1]);
  sun.position.set(60, 90, 40);
  sun.castShadow = !mobile;
  const ss = quality === 'high' ? 2048 : 1024;
  sun.shadow.mapSize.set(ss, ss);
  const shc = sun.shadow.camera;
  shc.left = -48; shc.right = 48; shc.top = 48; shc.bottom = -48; shc.near = 10; shc.far = 260;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.05;
  scene.add(sun);
  scene.add(sun.target);
  W.hemi = hemi;
  W.sun = sun;
  const sunOffset = new THREE.Vector3(60, 90, 40);

  /* ---------- terreno y estructuras ---------- */
  const ground = sc.paint();
  buildTerrain(scene, ground.tex, { tint: !!sc.terrainTint });
  W.groundCanvas = ground.canvas;
  W.city = sc; // compatibilidad (minimapa)
  W.mapView = sc.mapView || { cx: 0, cz: -15, half: 95 };

  const treeTime = { value: 0 };
  const windAmp = { value: sc.windAmp ?? 1 };
  W.windAmp = windAmp;
  const mats = {
    flat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05 }),
    trees: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
    treeInst: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }),
  };
  if (sc.facade) mats.facade = new THREE.MeshStandardMaterial({ map: sc.facade.map, emissiveMap: sc.facade.em, emissive: 0xffffff, emissiveIntensity: 1.6, vertexColors: true, roughness: 0.88 });
  mats.trees.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = treeTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float kk = clamp((transformed.y - 2.5) / 8.0, 0.0, 1.0);
        transformed.x += sin(uTime * 1.5 + transformed.z * 0.15 + transformed.x * 0.1) * 0.16 * kk * kk;
        transformed.z += cos(uTime * 1.2 + transformed.x * 0.13) * 0.12 * kk * kk;`);
  };
  mats.treeInst.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = treeTime;
    shader.uniforms.uWindAmp = windAmp;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWindAmp;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float kk = clamp((position.y - 1.2) / 6.0, 0.0, 1.0);
        float ph = 0.0;
        #ifdef USE_INSTANCING
          ph = instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.11;
        #endif
        transformed.x += sin(uTime * 1.6 + ph) * 0.16 * kk * kk * uWindAmp;
        transformed.z += cos(uTime * 1.3 + ph * 1.3) * 0.12 * kk * kk * uWindAmp;`);
  };
  for (const b of sc.batches) b.build(scene, mats, { glow: { cast: false, receive: false }, trees: { receive: false } });
  W.treeMeshes = K.buildTrees(scene, mats.treeInst);
  W.mats = mats;

  const hm = bakeHeightMap(sc.buildings);
  W.heightData = hm.data;

  /* ---------- agua, lluvia, ondas, pájaros ---------- */
  const water = createWater(scene, hm.tex, { x0: CFG.MAP.x0, z0: CFG.MAP.z0, size: CFG.MAP.size }, { segments: mobile ? 110 : 220 });
  water.mesh.visible = hasWater;
  water.uniforms.uFogColor.value.set(look.fog);
  water.uniforms.uFogDensity.value = look.fogD;
  if (wcfg.colors) {
    water.uniforms.uShallow.value.set(wcfg.colors.shallow);
    water.uniforms.uDeep.value.set(wcfg.colors.deep);
    water.uniforms.uMud.value.set(wcfg.colors.mud);
  }
  water.uniforms.uAmp.value = wcfg.amp ?? 1;
  W.water = water;
  const rain = createRain(scene, quality === 'high' ? 4200 : mobile ? 1400 : 2200);
  if (look.precip) {
    const pr = look.precip;
    rain.uniforms.uColor.value.setRGB(...pr.color);
    rain.uniforms.uAlpha.value = pr.alpha;
    rain.uniforms.uSpeed.value = pr.speed;
    rain.uniforms.uLen.value = pr.len;
    rain.uniforms.uWind.value.set(...pr.wind);
    W.precipAlpha = pr.alpha;
  } else rain.lines.visible = false;
  W.rain = rain;
  W.fogMul = 1;
  W.setFog = (d) => {
    const v = d * W.fogMul;
    scene.fog.density = v;
    water.uniforms.uFogDensity.value = v;
  };
  W.ripples = new Ripples(scene, 110);
  const birds = look.birds === false ? null : createBirds(scene, mobile ? 6 : 12);

  /* ---------- rejilla espacial de sólidos ---------- */
  const CELL = 8;
  const GN = 256 / CELL;
  const grid = Array.from({ length: GN * GN }, () => []);
  for (const s of sc.solids) {
    const i0 = clamp(Math.floor((s.x0 + 128) / CELL), 0, GN - 1), i1 = clamp(Math.floor((s.x1 + 128) / CELL), 0, GN - 1);
    const j0 = clamp(Math.floor((s.z0 + 128) / CELL), 0, GN - 1), j1 = clamp(Math.floor((s.z1 + 128) / CELL), 0, GN - 1);
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
  W.flowAt = (x, z) => {
    if (sc.flowAt) return sc.flowAt(x, z, W, flowOut);
    flowOut.x = 0;
    flowOut.z = 0;
    return flowOut;
  };
  W.slowAt = sc.slowAt || null;

  /* ---------- cuerpos dinámicos ---------- */
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
  const carGeoCache = new Map();
  function makeCar(x, z, axis, color) {
    let geo = carGeoCache.get(color);
    if (!geo) carGeoCache.set(color, (geo = carGeometry(color)));
    const mesh = new THREE.Mesh(geo, mats.flat);
    mesh.castShadow = !mobile;
    mesh.receiveShadow = true;
    mesh.rotation.y = axis === 'z' ? Math.PI / 2 : 0;
    return addBody({ kind: 'car', mesh, x, z, axis, hx: axis === 'x' ? 2.1 : 0.95, hz: axis === 'x' ? 0.95 : 2.1, h: 1.5, draft: 0.5, drift: 0.55, rescue: 1.5, rescueX: -0.15 });
  }
  function removeBody(b) {
    scene.remove(b.mesh);
    if (b.solid) {
      const k = W.dynSolids.indexOf(b.solid);
      if (k >= 0) W.dynSolids.splice(k, 1);
    }
    bodies.splice(bodies.indexOf(b), 1);
  }
  // retira cuerpos que chocan con edificios/otros o que están demasiado cerca del inicio
  function pruneBodies(startClear = 9) {
    for (let i = bodies.length - 1; i >= 0; i--) {
      const b = bodies[i];
      if (!b.hx) continue;
      const near = [];
      W.solidsNear(b.x - b.hx, b.x + b.hx, b.z - b.hz, b.z + b.hz, near);
      const clash = near.some((s) => !s.dyn && s.tag !== 'tree' && s.y1 > b.restY + 0.4) || Math.hypot(b.x - CFG.START.x, b.z - CFG.START.z) < startClear;
      if (clash) removeBody(b);
    }
    for (let i = bodies.length - 1; i >= 0; i--) {
      const a = bodies[i];
      if (!a.hx) continue;
      for (let j = 0; j < i; j++) {
        const c = bodies[j];
        if (!c.hx) continue;
        if (Math.abs(a.x - c.x) < a.hx + c.hx + 0.3 && Math.abs(a.z - c.z) < a.hz + c.hz + 0.3) {
          removeBody(a);
          break;
        }
      }
    }
  }
  W.H = { addBody, makeCar, mats, rng, pruneBodies, removeBody, mobile, scene };
  if (sc.populate) sc.populate(W, W.H);
  W.pushables = bodies.filter((b) => b.pushR);

  /* ---------- candidatos y rescates ---------- */
  W.candidates = sc.cands;
  W.bodyCandidates = () => bodies.filter((b) => b.rescue != null && b.hx).map((b) => ({ body: b, ly: b.rescue, type: 'vehicle', zone: 'vehículos', x: b.x0, z: b.z0, y: b.restY + b.rescue }));
  W.noSpawn = sc.noSpawn || null;

  /* ---------- obstáculos rompibles ---------- */
  const obsGroup = new THREE.Group();
  scene.add(obsGroup);
  W.obstacles = [];
  const woodM = new THREE.MeshStandardMaterial({ color: 0x6a4a2e, roughness: 0.9 });
  const leafM = new THREE.MeshStandardMaterial({ color: 0x4a7a34, roughness: 0.9, flatShading: true });
  const plankM = new THREE.MeshStandardMaterial({ color: 0x9a7048, roughness: 0.9 });
  const coverCols = { sand: 0xd8b878, ash: 0x55504c, snow: 0xeef4fa, tarp: 0x2e86c1, dust: 0xb09a80 };
  W.addObstacle = ({ kind = 'branch', x, z, y, breakBy = 'axe', ry = 0, size = 1 }) => {
    const gy = y ?? terrainH(x, z);
    const g = new THREE.Group();
    g.position.set(x, gy, z);
    g.rotation.y = ry;
    let w = 2.6 * size, h = 1.3 * size, d = 1.6 * size;
    if (kind === 'branch') {
      for (let i = 0; i < 3; i++) {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 2.6 * size, 6), woodM);
        c.position.set(0, 0.5 + i * 0.28, 0);
        c.rotation.set(Math.PI / 2 + (i - 1) * 0.35, i * 0.6, (i - 1) * 0.4);
        c.castShadow = true;
        g.add(c);
      }
      const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8 * size, 0), leafM);
      leaves.position.set(0.5, 0.7, 0.2);
      leaves.scale.set(1.3, 0.8, 1);
      g.add(leaves);
    } else if (kind === 'planks') {
      for (let i = 0; i < 5; i++) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(2.6 * size, 0.14, 0.42), plankM);
        p.position.set(0, 0.2 + i * 0.22, (i % 2 ? 0.25 : -0.25));
        p.rotation.set(0, (i - 2) * 0.16, (i % 2 ? 0.08 : -0.08));
        p.castShadow = true;
        g.add(p);
      }
    } else if (kind === 'trunk') {
      w = 4.2 * size; h = 1.3 * size; d = 1.3 * size;
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.62 * size, 0.7 * size, 4.2 * size, 9), woodM);
      c.rotation.z = Math.PI / 2;
      c.position.y = 0.62 * size;
      c.castShadow = true;
      g.add(c);
      const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 1.2, 6), woodM);
      stub.position.set(0.6, 1.3 * size, 0.3);
      stub.rotation.z = -0.7;
      g.add(stub);
    } else {
      // montones ligeros (se despejan con el viento)
      const col = coverCols[kind] ?? coverCols.sand;
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4 * size, 1), new THREE.MeshStandardMaterial({ color: col, roughness: 1, flatShading: true }));
      m.scale.set(1.5, 0.7, 1.2);
      m.position.y = 0.35;
      m.castShadow = true;
      g.add(m);
      w = 3.0 * size; h = 1.1 * size; d = 2.4 * size;
    }
    obsGroup.add(g);
    const c = Math.abs(Math.cos(ry)), s2 = Math.abs(Math.sin(ry));
    const ex = (w * c + d * s2) / 2, ez = (w * s2 + d * c) / 2;
    const solid = { x0: x - ex, x1: x + ex, y0: gy - 1, y1: gy + h, z0: z - ez, z1: z + ez, tag: 'obstacle', dyn: true, dx: 0, dy: 0, dz: 0, _q: 0 };
    W.dynSolids.push(solid);
    const o = { kind, breakBy, x, y: gy, z, g, solid, alive: true, w, d, h };
    solid.obs = o;
    W.obstacles.push(o);
    return o;
  };
  W.breakObstacle = (o) => {
    if (!o.alive) return;
    o.alive = false;
    obsGroup.remove(o.g);
    const k = W.dynSolids.indexOf(o.solid);
    if (k >= 0) W.dynSolids.splice(k, 1);
    if (W.onObstacleBroken) W.onObstacleBroken(o);
  };
  W.clearObstacles = () => {
    for (const o of [...W.obstacles]) {
      obsGroup.remove(o.g);
      const k = W.dynSolids.indexOf(o.solid);
      if (k >= 0) W.dynSolids.splice(k, 1);
    }
    W.obstacles = [];
  };
  // anillo de obstáculos alrededor de un punto (rescatado atrapado)
  W.addRing = (x, y, z, breakBy, kind) => {
    const out = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.4;
      out.push(W.addObstacle({ kind, x: x + Math.cos(a) * 1.9, z: z + Math.sin(a) * 1.9, y: y - 0.02, breakBy, ry: a + Math.PI / 2, size: 0.9 }));
    }
    return out;
  };
  // obstáculos sueltos por el mapa (dificultad): solo con herramientas para retirarlos y sin cortar el paso
  W.scatterObstacles = (n, tools) => {
    const kinds = [];
    if (tools.has('axe')) kinds.push(['branch', 'axe'], ['planks', 'axe'], ['trunk', 'axe']);
    if (tools.has('wind') && sc.windCover) kinds.push([sc.coverKind || 'sand', 'wind']);
    if (!kinds.length || !sc.sites.length) return;
    for (let i = 0; i < n; i++) {
      const site = sc.sites[Math.floor(rng.next() * sc.sites.length)];
      const [kind, tool] = kinds[Math.floor(rng.next() * kinds.length)];
      if (Math.hypot(site.x - CFG.START.x, site.z - CFG.START.z) < 14) continue;
      if (Math.hypot(site.x - CFG.SAFE.x, site.z - CFG.SAFE.z) < 14) continue;
      W.addObstacle({ kind, x: site.x, z: site.z, breakBy: tool, ry: site.ry || rng.range(0, TAU) });
    }
  };

  W.generateRescues = (params) => {
    const slots = generateRescues(W, params);
    for (const s of slots) {
      s.blockers = [];
      if (s.obstacleKind === 'axe') s.blockers = W.addRing(s.x, s.y, s.z, 'axe', rng.pick(['branch', 'planks', 'trunk']));
      else if (s.obstacleKind === 'wind') s.blockers = W.addRing(s.x, s.y, s.z, 'wind', sc.coverKind || 'sand');
    }
    return slots;
  };
  W.recomputeReach = () => { W.reach = computeReach(W, { half: sc.bounds ?? 112 }); };

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
    if (!hasWater) return -50;
    const k = clamp(t / W.duration, 0, 1);
    const base = wcfg.base + (wcfg.max - wcfg.base) * Math.pow(k, wcfg.pow ?? 1.2);
    const surge = wcfg.surge ? wcfg.surge * smoothstep(wcfg.surgeAt, wcfg.surgeAt + 7, t) : 0;
    return base + surge;
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
    W.clearObstacles();
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
    windAmp.value = sc.windAmp ?? 1;
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
    W.waterY = hasWater ? W.levelAt(missionT) + Math.sin(t * 0.7) * 0.02 : -50;
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
    if (birds) birds.update(t);

    lightningTimer -= dt;
    if (lightningTimer <= 0 && gameOn && look.lightning) {
      W.triggerLightning();
      lightningTimer = rng.range(9, 22) / (0.6 + W.stormIntensity);
    }
    flash = Math.max(0, flash - dt * 3.2);
    const fl = flash > 0.7 ? 1 : flash > 0.45 ? 0.25 : flash > 0.3 ? 0.9 : flash * 0.5;
    sky.mat.uniforms.uFlash.value = fl;
    wu.uFlash.value = fl;
    hemi.intensity = look.hemi[2] + fl * 2.2;
    if (look.precip) ru.uAlpha.value = look.precip.alpha - 0.02 + fl * 0.3;

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
        if (Math.abs(b.x) > 110) { b.x = clamp(b.x, -110, 110); b.vx = 0; }
        if (Math.abs(b.z) > 110) { b.z = clamp(b.z, -110, 110); b.vz = 0; }
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
    if (playerPos) {
      sun.target.position.set(playerPos.x, playerPos.y, playerPos.z);
      sun.position.set(playerPos.x + sunOffset.x, playerPos.y + sunOffset.y, playerPos.z + sunOffset.z);
    }
    const so = sc.safeObj;
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
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 0.01;
        out.x += (dx / d) * (rr - d) * 3 + b.vx * 0.5;
        out.z += (dz / d) * (rr - d) * 3 + b.vz * 0.5;
        out.hit = b;
      }
    }
    return out;
  };

  W.safe = CFG.SAFE;
  W.signs = sc.signs;
  W.sunLightRef = sun;
  return W;
}
