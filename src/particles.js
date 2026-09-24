import * as THREE from 'three';

const VERT = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
varying vec4 vColor;
uniform float uScale;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(aSize * uScale / max(0.1, -mv.z), 110.0);
}`;
const FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec4 vColor;
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  float a = vColor.a * t.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb * t.rgb, a);
}`;

const _c0 = new THREE.Color();
const _c1 = new THREE.Color();

export class ParticleSystem {
  constructor(scene, { max = 600, texture, additive = true, depthTest = true } = {}) {
    this.max = max;
    this.i = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.c0 = new Float32Array(max * 3);
    this.c1 = new Float32Array(max * 3);
    this.a0 = new Float32Array(max);
    this.a1 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 4);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1);
    this.sizeAttr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('aColor', this.colAttr);
    this.geo.setAttribute('aSize', this.sizeAttr);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uMap: { value: texture }, uScale: { value: 800 } },
      transparent: true,
      depthWrite: false,
      depthTest,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 20 : 15;
    scene.add(this.points);
  }

  setScale(s) {
    this.mat.uniforms.uScale.value = s;
  }

  emit(x, y, z, vx, vy, vz, life, s0, s1, color0, color1, a0 = 1, a1 = 0, grav = 0, drag = 0) {
    const i = this.i;
    this.i = (this.i + 1) % this.max;
    const p = i * 3;
    this.pos[p] = x; this.pos[p + 1] = y; this.pos[p + 2] = z;
    this.vel[p] = vx; this.vel[p + 1] = vy; this.vel[p + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.s0[i] = s0; this.s1[i] = s1;
    _c0.set(color0);
    _c1.set(color1 === undefined ? color0 : color1);
    this.c0[p] = _c0.r; this.c0[p + 1] = _c0.g; this.c0[p + 2] = _c0.b;
    this.c1[p] = _c1.r; this.c1[p + 1] = _c1.g; this.c1[p + 2] = _c1.b;
    this.a0[i] = a0; this.a1[i] = a1;
    this.grav[i] = grav;
    this.drag[i] = drag;
  }

  update(dt) {
    const { pos, vel, col, size, life, maxLife } = this;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) {
        size[i] = 0;
        continue;
      }
      life[i] -= dt;
      const p = i * 3;
      if (life[i] <= 0) {
        size[i] = 0;
        col[i * 4 + 3] = 0;
        continue;
      }
      const k = 1 - life[i] / maxLife[i];
      const d = this.drag[i];
      if (d > 0) {
        const f = Math.exp(-d * dt);
        vel[p] *= f; vel[p + 1] *= f; vel[p + 2] *= f;
      }
      vel[p + 1] -= this.grav[i] * dt;
      pos[p] += vel[p] * dt;
      pos[p + 1] += vel[p + 1] * dt;
      pos[p + 2] += vel[p + 2] * dt;
      size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * k;
      const c = i * 4;
      col[c] = this.c0[p] + (this.c1[p] - this.c0[p]) * k;
      col[c + 1] = this.c0[p + 1] + (this.c1[p + 1] - this.c0[p + 1]) * k;
      col[c + 2] = this.c0[p + 2] + (this.c1[p + 2] - this.c0[p + 2]) * k;
      col[c + 3] = this.a0[i] + (this.a1[i] - this.a0[i]) * k;
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
  }
}
