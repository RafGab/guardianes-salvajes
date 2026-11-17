import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { terrainH } from './common.js';
import { particleTexture } from '../utils.js';

/* ======================================================================
   APOCALIA (Valle Titán) · consecuencias del impacto de un meteorito gigante
   · Cráter principal con el núcleo fundido (lava que late) y grietas incandescentes que salen de él
   · Restos del meteorito incrustados en el terreno: roca negra con vetas al rojo y humo
   · Bloques de roca arrancados y desplazados por la onda expansiva (inclinados hacia fuera)
   · Bosque arrasado: troncos caídos en abanico, todos apuntando en dirección contraria al impacto
   · Columna de humo y ceniza sobre el cráter, ceniza que flota por todo el valle y brasas
   · Luz rojiza del calor del terreno
   Todo fuera de las rutas (carretera, río, salida y refugio). Pensado para pocos draw calls.
   ====================================================================== */
export function createValleyFX(scene, K, { CRATER, MINI, ROUTES, free, rng }) {
  const rr = (a, b) => a + rng.next() * (b - a);
  const group = new THREE.Group(); group.name = 'apocalia-impacto';
  scene.add(group);
  const clear = (x, z, m = 0) => free(x, z) && ROUTES(x, z) > 6 + m;
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), P = new THREE.Vector3(), S = new THREE.Vector3();
  const colorize = (g, c) => { const n = g.attributes.position.count, col = new Float32Array(n * 3), cc = new THREE.Color(c); for (let i = 0; i < n; i++) col.set([cc.r, cc.g, cc.b], i * 3); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g; };
  const T0 = performance.now() / 1000;

  /* ---------- núcleo fundido del cráter ---------- */
  const lavaU = { uT: { value: 0 } };
  const lavaMat = new THREE.MeshStandardMaterial({ color: 0x3a0a02, emissive: 0xff5a10, emissiveIntensity: 1, roughness: 0.6 });
  lavaMat.onBeforeCompile = (sh) => {
    sh.uniforms.uT = lavaU.uT;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vLP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLP = position.xy;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform float uT; varying vec2 vLP;
      float lh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float ln(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(lh(i), lh(i + vec2(1, 0)), f.x), mix(lh(i + vec2(0, 1)), lh(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec2 q = vLP * 0.35;
        float n = ln(q + vec2(uT * 0.08, -uT * 0.05)) * 0.6 + ln(q * 2.7 - uT * 0.12) * 0.4;
        float crust = smoothstep(0.42, 0.62, n);                         // costra negra que flota sobre la lava
        float pulse = 0.75 + 0.25 * sin(uT * 1.7 + n * 6.0);
        totalEmissiveRadiance *= mix(1.0, 0.08, crust) * pulse;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.04, 0.04), crust);`);
  };
  const cy = terrainH(CRATER.x, CRATER.z);
  const lava = new THREE.Mesh(new THREE.CircleGeometry(CRATER.core, 48), lavaMat);
  lava.rotation.x = -Math.PI / 2; lava.position.set(CRATER.x, cy + 0.25, CRATER.z);
  lava.onBeforeRender = () => { lavaU.uT.value = performance.now() / 1000 - T0; };
  group.add(lava);
  // luces rojizas del calor (pocas)
  const L1 = new THREE.PointLight(0xff4a10, 30, 38, 1.6); L1.position.set(CRATER.x, cy + 4, CRATER.z); group.add(L1);
  // la roca fundida asoma en lagunas más pequeñas por el fondo del cráter
  for (let i = 0; i < 5; i++) {
    const a = rr(0, Math.PI * 2), r = rr(CRATER.core + 2, CRATER.r * 0.6), x = CRATER.x + Math.cos(a) * r, z = CRATER.z + Math.sin(a) * r;
    const m = new THREE.Mesh(new THREE.CircleGeometry(rr(1.2, 2.4), 20), lavaMat);
    m.rotation.x = -Math.PI / 2; m.position.set(x, terrainH(x, z) + 0.12, z);
    m.onBeforeRender = lava.onBeforeRender;
    group.add(m);
  }

  /* ---------- grietas incandescentes que salen del cráter (y otras sueltas que desprenden calor) ---------- */
  const crackGeos = [];
  const crack = (x, z, ang, len, w) => {
    const pts = []; let a = ang, cx = x, cz = z;
    for (let i = 0; i <= 14; i++) { pts.push([cx, cz]); a += rr(-0.35, 0.35); cx += Math.cos(a) * len / 14; cz += Math.sin(a) * len / 14; }
    const pos = [], idx = [], uv = [];
    pts.forEach((p, i) => {
      const n = pts[Math.min(i + 1, pts.length - 1)], q = pts[Math.max(i - 1, 0)];
      const dx = n[0] - q[0], dz = n[1] - q[1], l = Math.hypot(dx, dz) || 1, ww = w * (1 - i / pts.length * 0.8);
      const nx = -dz / l * ww, nz = dx / l * ww;
      pos.push(p[0] - nx, terrainH(p[0] - nx, p[1] - nz) + 0.07, p[1] - nz, p[0] + nx, terrainH(p[0] + nx, p[1] + nz) + 0.07, p[1] + nz);
      uv.push(0, i / 14, 1, i / 14);
      if (i < pts.length - 1) { const b = i * 2; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    crackGeos.push(g);
  };
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2 + rr(-0.15, 0.15); crack(CRATER.x + Math.cos(a) * (CRATER.core + 1), CRATER.z + Math.sin(a) * (CRATER.core + 1), a, rr(18, 34), rr(0.25, 0.45)); }
  for (let i = 0; i < 22; i++) { const x = rr(-90, 90), z = rr(-95, 90); if (clear(x, z, 2)) crack(x, z, rr(0, 6.28), rr(6, 14), rr(0.15, 0.3)); }
  const crackU = { uT: { value: 0 } };
  const crackMat = new THREE.ShaderMaterial({
    uniforms: crackU, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uT; varying vec2 vUv;
      void main(){
        float core = 1.0 - smoothstep(0.0, 0.5, abs(vUv.x - 0.5) * 2.0);
        float pulse = 0.7 + 0.3 * sin(uT * 2.0 - vUv.y * 12.0);
        vec3 c = mix(vec3(0.9, 0.2, 0.03), vec3(1.0, 0.75, 0.3), core * core);
        gl_FragColor = vec4(c * pulse, core * 0.85 * (1.0 - vUv.y * 0.55));
      }`,
  });
  const cracks = new THREE.Mesh(mergeGeometries(crackGeos), crackMat);
  cracks.renderOrder = 2; cracks.frustumCulled = false;
  cracks.onBeforeRender = () => { crackU.uT.value = performance.now() / 1000 - T0; };
  group.add(cracks);
  crackGeos.forEach((g) => g.dispose());

  /* ---------- restos del meteorito incrustados (roca negra con vetas al rojo) ---------- */
  const fragGeo = (() => { const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position, v = new THREE.Vector3(); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const k = 0.78 + 0.36 * Math.abs(Math.sin(v.x * 5.3 + v.y * 7.1 + v.z * 3.9)); p.setXYZ(i, v.x * k, v.y * k, v.z * k); } g.computeVertexNormals(); return g; })();
  const fragMat = new THREE.MeshStandardMaterial({ color: 0x1a1614, roughness: 0.85, metalness: 0.25, flatShading: true, emissive: 0xff3a08, emissiveIntensity: 0.0 });
  fragMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvFP = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vFP;').replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float vein = 1.0 - smoothstep(0.0, 0.08, abs(sin(vFP.x * 6.0 + sin(vFP.y * 5.0) * 1.6) * cos(vFP.z * 5.0 + vFP.y * 2.0)));
      totalEmissiveRadiance += vec3(1.0, 0.32, 0.05) * vein * 1.4;`); // vetas incandescentes
  };
  const frags = [];
  for (let i = 0; i < 9; i++) { const a = rr(0, Math.PI * 2), r = rr(CRATER.core + 1.5, CRATER.r * 0.85); frags.push([CRATER.x + Math.cos(a) * r, CRATER.z + Math.sin(a) * r, rr(1.4, 3.2)]); }
  frags.push([CRATER.x, CRATER.z, 4.2]); // el gran núcleo del meteorito en el centro de la lava
  for (const m of MINI) frags.push([m.x, m.z, m.r * 0.32]);
  for (let i = 0; i < 30; i++) { const x = rr(-95, 95), z = rr(-100, 95); if (clear(x, z, 1)) frags.push([x, z, rr(0.4, 1.2)]); }
  const fim = new THREE.InstancedMesh(fragGeo, fragMat, frags.length);
  frags.forEach(([x, z, s], i) => {
    const g = terrainH(x, z);
    E.set(rr(-0.5, 0.5), rr(0, 6.28), rr(-0.5, 0.5)); Q.setFromEuler(E);
    P.set(x, g + s * 0.25, z); S.set(s * rr(0.9, 1.2), s * rr(0.7, 1), s * rr(0.9, 1.2));
    M.compose(P, Q, S); fim.setMatrixAt(i, M);
    if (s > 1.3) K.solid(x - s * 0.8, x + s * 0.8, g - 1, g + s * 1.1, z - s * 0.8, z + s * 0.8, 'rock');
  });
  fim.castShadow = true; fim.receiveShadow = true;
  group.add(fim);

  /* ---------- bloques arrancados y desplazados por la onda expansiva ---------- */
  const slabG = [];
  const slabBase = new THREE.DodecahedronGeometry(0.75, 0); // bloques de roca angulosos (no cajas)
  for (let i = 0; i < 26; i++) {
    const a = rr(0, Math.PI * 2), r = rr(CRATER.r + 2, CRATER.r + 18), x = CRATER.x + Math.cos(a) * r, z = CRATER.z + Math.sin(a) * r;
    if (!clear(x, z, 3)) continue;
    const w = rr(2.5, 5), h = rr(1.5, 4), d = rr(1, 2), g = terrainH(x, z);
    const geo = slabBase.clone();
    E.set(0, -a, 0); Q.setFromEuler(E);
    const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, rr(0.35, 0.8))); // volcados hacia fuera del cráter
    Q.multiply(tilt);
    M.compose(P.set(x, g + h * 0.3, z), Q, S.set(d, h, w)); geo.applyMatrix4(M);
    slabG.push(colorize(geo, rng.next() < 0.5 ? 0x4a403a : 0x5a4e46));
    K.solid(x - w * 0.45, x + w * 0.45, g - 1, g + h * 0.75, z - w * 0.45, z + w * 0.45, 'rock');
  }
  // montañas fracturadas en las paredes del valle: agujas de roca partidas con grietas oscuras
  for (let i = 0; i < 18; i++) {
    const x = (i % 2 ? 1 : -1) * rr(70, 100) - 4, z = rr(-95, 90), g = terrainH(x, z);
    const geo = new THREE.ConeGeometry(rr(3, 6), rr(8, 16), 5);
    E.set(rr(-0.25, 0.25), rr(0, 6.28), rr(-0.25, 0.25)); Q.setFromEuler(E);
    M.compose(P.set(x, g + 3, z), Q, S.set(1, 1, 1)); geo.applyMatrix4(M);
    slabG.push(colorize(geo.toNonIndexed(), 0x3a3230));
  }
  const slabs = new THREE.Mesh(mergeGeometries(slabG.map((g) => (g.index ? g.toNonIndexed() : g))), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }));
  slabs.castShadow = true; slabs.receiveShadow = true;
  group.add(slabs);

  /* ---------- bosque arrasado: troncos caídos en abanico (apuntan lejos del impacto) ---------- */
  const logG = [];
  for (let i = 0; i < 70; i++) {
    const x = rr(-95, 95), z = rr(-95, 90), dc = Math.hypot(x - CRATER.x, z - CRATER.z);
    if (dc < CRATER.r + 4 || !clear(x, z, 1)) continue;
    const a = Math.atan2(z - CRATER.z, x - CRATER.x), len = rr(3, 6.5), r = rr(0.18, 0.32), g = terrainH(x, z);
    const geo = new THREE.CylinderGeometry(r * 0.75, r, len, 6);
    geo.rotateZ(Math.PI / 2);
    E.set(0, -a + rr(-0.25, 0.25), 0); Q.setFromEuler(E);
    M.compose(P.set(x, g + r * 0.8, z), Q, S.set(1, 1, 1)); geo.applyMatrix4(M);
    logG.push(colorize(geo.toNonIndexed(), rng.next() < 0.5 ? 0x1e1814 : 0x2c221a));
    // tocón quemado donde estaba el árbol
    const st = new THREE.CylinderGeometry(r, r * 1.2, 0.6, 6); st.translate(x - Math.cos(a) * len * 0.5, g + 0.25, z - Math.sin(a) * len * 0.5);
    logG.push(colorize(st.toNonIndexed(), 0x16120f));
  }
  const logs = new THREE.Mesh(mergeGeometries(logG), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  logs.castShadow = true; logs.receiveShadow = true;
  group.add(logs);

  /* ---------- columna de humo y ceniza sobre el cráter ---------- */
  const smokeTex = particleTexture('smoke');
  const plume = [];
  for (let i = 0; i < 16; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: i % 3 ? 0x2a2420 : 0x3a2c26, transparent: true, opacity: 0.0, depthWrite: false, fog: true }));
    sp.userData = { ph: i / 16, sx: rr(-3, 3), sz: rr(-3, 3) };
    group.add(sp); plume.push(sp);
  }
  // brasas y ceniza que flotan por el valle (alrededor de la cámara)
  const N = 700, ap = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) { ap.set([rr(-40, 40), rr(0, 22), rr(-40, 40)], i * 3); seed[i] = rng.next(); }
  const ag = new THREE.BufferGeometry(); ag.setAttribute('position', new THREE.BufferAttribute(ap, 3)); ag.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const au = { uT: { value: 0 }, uC: { value: new THREE.Vector3() } };
  const ash = new THREE.Points(ag, new THREE.ShaderMaterial({
    uniforms: au, transparent: true, depthWrite: false,
    vertexShader: `uniform float uT; uniform vec3 uC; attribute float seed; varying float vS;
      void main(){
        vec3 p = position; vS = seed;
        p.x += uT * (0.8 + seed) + sin(uT * 0.7 + seed * 20.0) * 1.5; p.y -= uT * (0.25 + 0.3 * seed); p.z += uT * 0.4 + cos(uT * 0.5 + seed * 13.0);
        p = mod(p - uC + vec3(40.0, 0.0, 40.0), vec3(80.0, 22.0, 80.0)) - vec3(40.0, 0.0, 40.0) + vec3(uC.x, uC.y - 4.0, uC.z);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (seed > 0.93 ? 5.0 : 3.2) * (40.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying float vS;
      void main(){ vec2 d = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.15, length(d));
        vec3 c = vS > 0.93 ? vec3(1.0, 0.45, 0.12) : vec3(0.55, 0.5, 0.48);   // pocas brasas, mucha ceniza gris
        gl_FragColor = vec4(c, a * (vS > 0.93 ? 0.85 : 0.5)); }`,
  }));
  ash.frustumCulled = false;
  group.add(ash);
  // animación (sin bucle propio: se actualiza al dibujarse)
  ash.onBeforeRender = (r, sc, cam) => {
    const t = performance.now() / 1000 - T0;
    au.uT.value = t; au.uC.value.copy(cam.position);
    for (const sp of plume) {
      const u = (sp.userData.ph + t * 0.025) % 1;
      sp.position.set(CRATER.x + sp.userData.sx * (1 + u * 2) + u * 10, cy + 3 + u * 48, CRATER.z + sp.userData.sz * (1 + u * 2) + u * 4);
      sp.scale.setScalar(7 + u * 20);
      // se aclara si la cámara se acerca: nunca tapa la pantalla
      const dc = cam.position.distanceTo(sp.position), near = Math.min(1, Math.max(0, (dc - sp.scale.x * 0.6) / 20));
      sp.material.opacity = 0.42 * Math.sin(u * Math.PI) * (u < 0.1 ? u / 0.1 : 1) * near;
      sp.material.color.setHex(u < 0.12 ? 0x7a3a1a : 0x2a2420); // abajo, iluminada por la lava
    }
    L1.intensity = 26 + 6 * Math.sin(t * 1.7) + 3 * Math.sin(t * 5.3);
  };
  return group;
}
