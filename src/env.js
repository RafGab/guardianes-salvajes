import * as THREE from 'three';
import { makeRng, TAU } from './utils.js';

/* ------------------------------------------------------------------ */
/*  Cielo con nubes de tormenta (shader)                               */
/* ------------------------------------------------------------------ */
export function createSky(scene) {
  const geo = new THREE.SphereGeometry(900, 32, 20);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTime: { value: 0 },
      uFlash: { value: 0 },
      uHorizon: { value: new THREE.Color(0x5f7085) },
      uZenith: { value: new THREE.Color(0x1c2532) },
      uSun: { value: new THREE.Vector3(0.45, 0.5, 0.3).normalize() },
      uDark: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * p;
        gl_Position.z = gl_Position.w * 0.9999;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform float uTime, uFlash, uDark;
      uniform vec3 uHorizon, uZenith, uSun;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
      }
      float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(uHorizon, uZenith, pow(h, 0.5));
        vec2 uv = d.xz / (max(d.y, 0.0) + 0.32) * 1.1 + vec2(uTime * 0.010, uTime * 0.005);
        float c = smoothstep(0.32, 0.8, fbm(uv * 1.4));
        float shade = fbm(uv * 2.6 + 4.0);
        vec3 cloudCol = mix(vec3(0.07, 0.085, 0.11), vec3(0.42, 0.47, 0.55), shade);
        cloudCol *= mix(1.0, 0.55, uDark);
        col = mix(col, cloudCol, c * smoothstep(-0.02, 0.22, d.y) * 0.96);
        float sun = pow(max(dot(d, uSun), 0.0), 40.0) * 0.16;
        col += vec3(1.0, 0.85, 0.65) * sun * (1.0 - c * 0.85);
        col += uFlash * vec3(0.6, 0.66, 1.0) * (0.35 + fbm(uv * 3.0)) * (0.4 + 0.6 * c);
        if (d.y < 0.0) col = mix(col, uHorizon * 0.85, smoothstep(0.0, -0.25, d.y));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  scene.add(mesh);
  return { mesh, mat };
}

/* ------------------------------------------------------------------ */
/*  Agua: olas, reflejo del cielo, espuma en orillas (mapa de alturas) */
/* ------------------------------------------------------------------ */
export function createWater(scene, heightTex, rect) {
  const size = 640;
  const geo = new THREE.PlaneGeometry(size, size, 220, 220);
  geo.rotateX(-Math.PI / 2);
  const uniforms = {
    uTime: { value: 0 },
    uLevel: { value: 0 },
    uSun: { value: new THREE.Vector3(0.45, 0.5, 0.3).normalize() },
    uFogColor: { value: new THREE.Color(0x5f7085) },
    uFogDensity: { value: 0.0065 },
    uHeight: { value: heightTex },
    uRect: { value: new THREE.Vector3(rect.x0, rect.z0, rect.size) },
    uShallow: { value: new THREE.Color(0x4b8f8a) },
    uDeep: { value: new THREE.Color(0x0f3a4a) },
    uMud: { value: new THREE.Color(0x6f6a4a) },
    uFlash: { value: 0 },
    uFlow: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vWorld;
      void main() {
        vec3 p = position;
        vec4 w = modelMatrix * vec4(p, 1.0);
        float d = sin(w.x * 0.21 + uTime * 1.2) * 0.5 + sin(w.z * 0.27 - uTime * 1.0) * 0.5 + sin((w.x + w.z) * 0.11 + uTime * 0.7) * 0.6;
        w.y += d * 0.055;
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uLevel, uFogDensity, uFlash, uFlow;
      uniform vec3 uSun, uFogColor, uRect, uShallow, uDeep, uMud;
      uniform sampler2D uHeight;
      varying vec3 vWorld;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
      }
      void wave(vec2 p, vec2 d, float f, float a, float s, inout vec2 g) {
        float ph = dot(d, p) * f + uTime * s;
        g += d * f * a * cos(ph);
      }
      void main() {
        vec2 p = vWorld.xz;
        vec2 uvh = (p - uRect.xy) / uRect.z;
        float H = texture2D(uHeight, uvh).r;
        float depth = uLevel - H;
        if (depth < -0.02) discard;
        vec2 g = vec2(0.0);
        wave(p, normalize(vec2(1.0, 0.3)), 0.9, 0.05, 1.7, g);
        wave(p, normalize(vec2(-0.4, 1.0)), 1.3, 0.04, 2.1, g);
        wave(p, normalize(vec2(0.7, -0.7)), 2.3, 0.03, 2.9, g);
        wave(p, normalize(vec2(0.2, 0.9)), 3.7, 0.02, 3.4, g);
        wave(p, normalize(vec2(-1.0, -0.2)), 6.1, 0.012, 4.6, g);
        vec2 fl = vec2(1.0, 0.0) * uFlow;
        g += (vec2(noise(p * 1.7 + fl * uTime * 0.9), noise(p * 1.7 + 17.0 + fl * uTime * 0.9)) - 0.5) * 0.18;
        vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
        vec3 V = normalize(cameraPosition - vWorld);
        float dist = length(cameraPosition - vWorld);
        vec3 R = reflect(-V, N);
        float ry = clamp(R.y, 0.0, 1.0);
        vec3 sky = mix(vec3(0.13, 0.16, 0.20), vec3(0.04, 0.06, 0.09), pow(ry, 0.5));
        sky += uFlash * vec3(0.5, 0.55, 0.9);
        float fres = 0.02 + 0.6 * pow(1.0 - max(dot(N, V), 0.0), 4.0);
        float dd = clamp(depth, 0.0, 6.0);
        vec3 body = mix(uShallow, uDeep, smoothstep(0.0, 3.5, dd));
        body = mix(body, uMud, 0.35 * (1.0 - smoothstep(0.0, 1.2, dd)) + 0.15);
        vec3 col = mix(body, sky, clamp(fres * 1.15, 0.0, 0.92));
        float spec = pow(max(dot(R, uSun), 0.0), 220.0) * 1.6;
        col += vec3(1.0, 0.92, 0.8) * spec;
        // espuma en las orillas y alrededor de edificios
        float edge = 1.0 - smoothstep(0.0, 0.16, depth);
        float fn = noise(p * 2.6 + uTime * 0.35) * 0.65 + noise(p * 6.0 - uTime * 0.5) * 0.45;
        float foam = smoothstep(0.5, 0.85, fn + edge * 0.6) * edge;
        col = mix(col, vec3(0.8, 0.85, 0.88), foam * 0.7);
        // vetas de corriente
        float streak = pow(noise(vec2(p.x * 0.35 - uTime * 1.2 * uFlow, p.y * 2.4)), 3.0) * uFlow * 0.25;
        col += streak;
        float alpha = mix(0.32, 0.93, smoothstep(0.0, 1.3, depth));
        alpha = max(alpha, foam * 0.9);
        float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
        col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
        gl_FragColor = vec4(col, alpha);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 5;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return { mesh, mat, uniforms };
}

/* ------------------------------------------------------------------ */
/*  Lluvia con shader (líneas que caen alrededor de la cámara)         */
/* ------------------------------------------------------------------ */
export function createRain(scene, count = 3500) {
  const geo = new THREE.BufferGeometry();
  const seed = new Float32Array(count * 2 * 3);
  const end = new Float32Array(count * 2);
  const pos = new Float32Array(count * 2 * 3);
  const r = makeRng(99);
  for (let i = 0; i < count; i++) {
    const a = r.next(), b = r.next(), c = r.next();
    for (let k = 0; k < 2; k++) {
      const j = i * 2 + k;
      seed[j * 3] = a; seed[j * 3 + 1] = b; seed[j * 3 + 2] = c;
      end[j] = k;
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
  geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  const uniforms = {
    uTime: { value: 0 },
    uCam: { value: new THREE.Vector3() },
    uArea: { value: 46 },
    uHeight: { value: 34 },
    uSpeed: { value: 30 },
    uLen: { value: 0.9 },
    uWind: { value: new THREE.Vector3(3.5, 0, 1.2) },
    uAlpha: { value: 0.32 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      uniform float uTime, uArea, uHeight, uSpeed, uLen;
      uniform vec3 uCam, uWind;
      attribute vec3 aSeed;
      attribute float aEnd;
      varying float vA;
      void main() {
        vec3 c = uCam;
        vec3 p;
        p.x = mod(aSeed.x * uArea - c.x + uArea * 0.5, uArea) - uArea * 0.5 + c.x;
        p.z = mod(aSeed.z * uArea - c.z + uArea * 0.5, uArea) - uArea * 0.5 + c.z;
        p.y = mod(aSeed.y * uHeight - uTime * uSpeed * (0.85 + aSeed.x * 0.3), uHeight) + c.y - uHeight * 0.4;
        vec3 dir = normalize(vec3(uWind.x, -uSpeed, uWind.z));
        p -= dir * uLen * aEnd;
        vA = 1.0 - aEnd * 0.8;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uAlpha;
      varying float vA;
      void main() { gl_FragColor = vec4(0.72, 0.8, 0.9, uAlpha * vA); }`,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 30;
  scene.add(lines);
  return { lines, uniforms };
}

/* ------------------------------------------------------------------ */
/*  Ondas planas sobre el agua (pool de anillos instanciados)          */
/* ------------------------------------------------------------------ */
export class Ripples {
  constructor(scene, max = 90) {
    this.max = max;
    const geo = new THREE.RingGeometry(0.42, 0.5, 20);
    geo.rotateX(-Math.PI / 2);
    this.mat = new THREE.MeshBasicMaterial({ color: 0xdfeeff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.items = [];
    for (let i = 0; i < max; i++) this.items.push({ life: 0, max: 1, x: 0, y: 0, z: 0, s: 1 });
    this.i = 0;
    this.m = new THREE.Matrix4();
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
  }
  spawn(x, y, z, size = 1, life = 0.9) {
    const it = this.items[this.i];
    this.i = (this.i + 1) % this.max;
    it.x = x; it.y = y; it.z = z; it.s = size; it.life = life; it.max = life;
  }
  update(dt) {
    const m = this.m;
    for (let i = 0; i < this.max; i++) {
      const it = this.items[i];
      if (it.life > 0) it.life -= dt;
      const k = it.life > 0 ? 1 - it.life / it.max : 1;
      const s = it.life > 0 ? it.s * (0.2 + k * 1.6) : 0.0001;
      m.makeScale(s, 1, s);
      m.setPosition(it.x, it.y, it.z);
      this.mesh.setMatrixAt(i, m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ */
/*  Pájaros (gaviotas) que sobrevuelan la ciudad                       */
/* ------------------------------------------------------------------ */
export function createBirds(scene, n = 12) {
  const birds = [];
  const body = new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.8 });
  const tip = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.8 });
  const wingGeo = new THREE.BoxGeometry(1.0, 0.03, 0.34);
  wingGeo.translate(0.5, 0, 0);
  const r = makeRng(7);
  for (let i = 0; i < n; i++) {
    const g = new THREE.Group();
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), body);
    b.scale.set(0.8, 0.7, 1.7);
    g.add(b);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), body);
    head.position.set(0, 0.04, 0.34);
    g.add(head);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.14, 5), new THREE.MeshStandardMaterial({ color: 0xf0a020 }));
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.03, 0.46);
    g.add(beak);
    const wings = [];
    for (const s of [-1, 1]) {
      const w = new THREE.Group();
      w.position.set(s * 0.1, 0.05, 0);
      w.scale.x = s;
      const a = new THREE.Mesh(wingGeo, body);
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 0.28), tip);
      t.position.set(1.15, 0, -0.03);
      w.add(a, t);
      g.add(w);
      wings.push(w);
    }
    g.scale.setScalar(1.6);
    scene.add(g);
    birds.push({ g, wings, cx: r.range(-40, 40), cz: r.range(-40, 40), rad: r.range(30, 70), h: r.range(28, 60), sp: r.range(0.08, 0.16) * (r.chance(0.5) ? 1 : -1), ph: r.range(0, TAU), flap: r.range(7, 11) });
  }
  return {
    update(t) {
      for (const b of birds) {
        const a = b.ph + t * b.sp;
        const x = b.cx + Math.cos(a) * b.rad;
        const z = b.cz + Math.sin(a) * b.rad;
        b.g.position.set(x, b.h + Math.sin(t * 0.5 + b.ph) * 3, z);
        b.g.rotation.y = -a + (b.sp > 0 ? 0 : Math.PI) + (b.sp > 0 ? -Math.PI / 2 : Math.PI / 2);
        b.g.rotation.z = -Math.sign(b.sp) * 0.25;
        const f = Math.sin(t * b.flap + b.ph) * 0.55;
        b.wings[0].rotation.z = f;
        b.wings[1].rotation.z = -f;
      }
    },
  };
}
