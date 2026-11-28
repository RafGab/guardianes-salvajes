import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { IS_TOUCH } from './platform.js';

/* ======================================================================
   ESCENARIO DE PRESENTACIÓN DE HÉROES (pantalla de selección)
   Escena propia, oscura y cinematográfica, que se dibuja con la misma tubería del juego (resplandor y color):
   · plataforma circular futurista: base metálica PBR, superficie holográfica (hexágonos, anillos y arcos que
     giran), aro de luz y marcas tecnológicas en el borde;
   · iluminación de cine: luz principal con sombras, dos luces de contorno detrás del héroe, relleno suave y
     resplandor bajo los pies; un cono de luz volumétrica cae sobre la plataforma;
   · suelo reflectante (entorno PBR) con rejilla que se desvanece y niebla de fondo;
   · partículas ambientales que suben despacio alrededor del héroe.
   El color de las luces, la plataforma y el fondo cambia con el elemento de cada héroe.
   El héroe es SU MODELO 3D REAL del juego (getHeroModel): aquí solo se coloca, se ilumina y se anima.
   ====================================================================== */
const WHITE = new THREE.Color(0xffffff);
const _X = new THREE.Vector3(1, 0, 0), _Y = new THREE.Vector3(0, 1, 0), _Z = new THREE.Vector3(0, 0, 1), _q = new THREE.Quaternion();
const rotAdd = (b, axis, ang) => { if (b && ang) b.quaternion.multiply(_q.setFromAxisAngle(axis, ang)); };
const PLAT_R = 1.35;   // radio de la plataforma (m)
const PLAT_H = 0.24;   // altura de la plataforma

// sombreador de la superficie holográfica de la plataforma
function holoMat() {
  return new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uC: { value: new THREE.Color() }, uK: { value: 1 }, uPulse: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uT; uniform vec3 uC; uniform float uK; uniform float uPulse; varying vec2 vP;
      float hexD(vec2 p){ p = abs(p); return max(dot(p, normalize(vec2(1.0, 1.732))), p.x); }
      void main(){
        float r = length(vP), a = atan(vP.y, vP.x);
        // rejilla hexagonal
        vec2 q = vP * 7.0; vec2 s = vec2(1.0, 1.732); vec2 h = s * 0.5;
        vec2 g1 = mod(q, s) - h, g2 = mod(q - h, s) - h; vec2 g = dot(g1, g1) < dot(g2, g2) ? g1 : g2;
        float hex = smoothstep(0.46, 0.5, hexD(g)) * 0.22;
        // anillos concéntricos y arcos que giran
        float rings = smoothstep(0.012, 0.0, abs(r - 0.92)) + smoothstep(0.008, 0.0, abs(r - 0.72)) * 0.7 + smoothstep(0.006, 0.0, abs(r - 0.45)) * 0.5;
        float arcs = smoothstep(0.02, 0.0, abs(r - 0.82)) * step(0.55, fract(a / 6.2832 * 3.0 + uT * 0.08));
        float arcs2 = smoothstep(0.015, 0.0, abs(r - 0.6)) * step(0.7, fract(-a / 6.2832 * 5.0 + uT * 0.12));
        float ticks = smoothstep(0.03, 0.0, abs(r - 0.97)) * step(0.82, fract(a / 6.2832 * 72.0));
        float sweep = pow(max(0.0, cos(a - uT * 0.9)), 18.0) * smoothstep(0.95, 0.2, r) * 0.35;
        float core = smoothstep(0.55, 0.0, r) * 0.18;
        float pulse = uPulse * smoothstep(0.05, 0.0, abs(r - (1.0 - uPulse) * 0.95));
        float v = (hex * smoothstep(1.0, 0.3, r) + rings * 0.9 + arcs * 0.8 + arcs2 * 0.6 + ticks * 0.7 + sweep + core + pulse * 1.5) * uK;
        gl_FragColor = vec4(mix(uC, vec3(1.0), 0.25 + 0.4 * pulse) * v, v * smoothstep(1.0, 0.98, r));
      }`,
  });
}
// cono de luz volumétrica (más intenso en el eje, se apaga arriba y en los bordes)
function beamMat() {
  return new THREE.ShaderMaterial({
    uniforms: { uC: { value: new THREE.Color() }, uK: { value: 0.35 }, uT: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
    vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: `uniform vec3 uC; uniform float uK; uniform float uT; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ float f = abs(dot(normalize(vN), normalize(vV))); float edge = pow(f, 2.2);
        float y = vUv.y; float fade = smoothstep(1.0, 0.25, y) * smoothstep(0.0, 0.08, y);
        float dust = 0.85 + 0.15 * sin(vUv.x * 40.0 + uT * 0.7) * sin(y * 23.0 - uT * 1.3);
        float a = edge * fade * dust * uK; gl_FragColor = vec4(mix(uC, vec3(1.0), 0.55) * a, a); }`,
  });
}
// fondo: degradado oscuro con un halo del color del héroe detrás de la plataforma y bandas de luz muy suaves
function skyMat() {
  return new THREE.ShaderMaterial({
    uniforms: { uC: { value: new THREE.Color() }, uT: { value: 0 } },
    side: THREE.BackSide, depthWrite: false, toneMapped: false, fog: false,
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 uC; uniform float uT; varying vec3 vD;
      void main(){ float y = vD.y; vec3 base = mix(vec3(0.004, 0.006, 0.012), vec3(0.012, 0.016, 0.03), smoothstep(-0.2, 0.6, y));
        float back = pow(max(0.0, -vD.z), 3.0);
        float halo = exp(-pow((y - 0.02) * 9.0, 2.0)) * back;
        float rays = pow(max(0.0, sin(atan(vD.x, -vD.z) * 9.0 + uT * 0.05)), 12.0) * smoothstep(0.0, 0.5, y) * back * 0.08;
        vec3 c = base + uC * (halo * 0.07 + rays * 0.5);
        gl_FragColor = vec4(c, 1.0); }`,
  });
}
// suelo: metal oscuro reflectante con rejilla que se apaga a lo lejos
function floorGridMat() {
  return new THREE.ShaderMaterial({
    uniforms: { uC: { value: new THREE.Color() } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 uC; varying vec2 vP;
      void main(){ vec2 g = abs(fract(vP * 0.8) - 0.5); float line = smoothstep(0.03, 0.0, min(g.x, g.y));
        float r = length(vP); float fade = smoothstep(9.0, 2.0, r) * smoothstep(1.4, 2.2, r);
        float ring = smoothstep(0.03, 0.0, abs(r - 2.6)) * 0.6 + smoothstep(0.02, 0.0, abs(r - 3.6)) * 0.35;
        float a = (line * 0.12 * fade + ring * smoothstep(9.0, 2.0, r)); gl_FragColor = vec4(uC * a, a); }`,
  });
}

export class HeroStage {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 16 / 9, 0.05, 120);
    this.scene.fog = new THREE.Fog(0x05070d, 9, 30);
    // entorno PBR (reflejos de los materiales metálicos de la plataforma y de los héroes)
    try {
      const pm = new THREE.PMREMGenerator(renderer);
      this.env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      pm.dispose();
      this.scene.environment = this.env;
      this.scene.environmentIntensity = 0.25;
    } catch (e) { /* sin entorno */ }
    this.col = new THREE.Color(0x9fc0ff);
    this.colT = new THREE.Color(0x9fc0ff);
    this.t = 0;
    this.build();
    this.hero = null;
    this.yaw = 0.3; this.yawV = 0; this.idleT = 0; this.baseYaw = 0.3;
    this.enterK = 1;
    this.view = { left: 0, right: 1, top: 0, bottom: 1 }; // hueco libre de la pantalla (fracciones), lo fija la interfaz
    this.w = 16; this.h = 9;
  }

  build() {
    const S = this.scene;
    // fondo y suelo
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(60, 32, 16), skyMat());
    S.add(this.sky);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.MeshStandardMaterial({ color: 0x05070c, metalness: 0.7, roughness: 0.38, envMapIntensity: 0.18 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    S.add(floor);
    this.grid = new THREE.Mesh(new THREE.CircleGeometry(12, 64), floorGridMat());
    this.grid.rotation.x = -Math.PI / 2; this.grid.position.y = 0.004; this.grid.renderOrder = 2;
    S.add(this.grid);

    // FONDO CON PROFUNDIDAD (discreto, para que el héroe destaque):
    //  · semicírculo de columnas metálicas con una línea de luz del color del héroe, que se pierden en la niebla;
    //  · gran halo doble detrás del héroe; · rayos de luz que caen desde arriba; · charco de luz suave en el suelo.
    this.bgMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.55 });
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x0d1119, metalness: 0.8, roughness: 0.45 });
    const pillarG = new THREE.BoxGeometry(0.5, 9, 0.5), stripG = new THREE.BoxGeometry(0.05, 7.4, 0.05), capG = new THREE.BoxGeometry(0.9, 0.12, 0.9);
    for (let i = 0; i < 13; i++) {
      const a = -Math.PI / 2 + (i - 6) * 0.2, r = 10.5 + (i % 2) * 1.6;
      const g = new THREE.Group();
      g.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      g.rotation.y = -a - Math.PI / 2;
      const p = new THREE.Mesh(pillarG, pillarMat); p.position.y = 4.5;
      const st = new THREE.Mesh(stripG, this.bgMat); st.position.set(0, 4.2, 0.27);
      const cap = new THREE.Mesh(capG, pillarMat); cap.position.y = 0.06;
      g.add(p, st, cap);
      S.add(g);
    }
    this.halo = new THREE.Group();
    const haloMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
    const h1 = new THREE.Mesh(new THREE.TorusGeometry(3.3, 0.012, 6, 160), haloMat);
    const h2 = new THREE.Mesh(new THREE.RingGeometry(2.9, 2.96, 160, 1, 0, Math.PI * 1.4), haloMat);
    const h3 = new THREE.Mesh(new THREE.RingGeometry(3.6, 3.64, 160, 1, Math.PI * 1.1, Math.PI * 0.6), haloMat);
    this.halo.add(h1, h2, h3); this.halo.position.set(0, 2.1, -4.2); this.haloMat = haloMat; this.haloArcs = [h2, h3];
    S.add(this.halo);
    this.rays = [];
    const rayMat = new THREE.ShaderMaterial({
      uniforms: { uC: { value: new THREE.Color() }, uK: { value: 0.08 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 uC; uniform float uK; varying vec2 vUv; void main(){ float a = smoothstep(0.0, 0.5, vUv.x) * smoothstep(1.0, 0.5, vUv.x) * smoothstep(0.0, 0.7, vUv.y) * uK; gl_FragColor = vec4(mix(uC, vec3(1.0), 0.4) * a, a); }',
    });
    this.rayMat = rayMat;
    for (const [x, z, rz, w] of [[-3.2, -6, 0.32, 1.6], [3.6, -6.5, -0.28, 2.2], [0.6, -7.5, 0.06, 1.2]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 14), rayMat);
      m.position.set(x, 6, z); m.rotation.z = rz; m.renderOrder = 1;
      S.add(m); this.rays.push(m);
    }
    this.pool = new THREE.Mesh(new THREE.CircleGeometry(6, 48), new THREE.ShaderMaterial({
      uniforms: { uC: { value: new THREE.Color() } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 uC; varying vec2 vP; void main(){ float a = pow(max(0.0, 1.0 - length(vP) / 6.0), 2.2) * 0.22; gl_FragColor = vec4(uC * a, a); }',
    }));
    this.pool.rotation.x = -Math.PI / 2; this.pool.position.y = 0.003; this.pool.renderOrder = 1;
    S.add(this.pool);

    // PLATAFORMA
    const plat = (this.plat = new THREE.Group());
    S.add(plat);
    const metal = new THREE.MeshStandardMaterial({ color: 0x1a2030, metalness: 0.9, roughness: 0.28, envMapIntensity: 1 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x0b0e16, metalness: 0.8, roughness: 0.4 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(PLAT_R + 0.12, PLAT_R + 0.28, PLAT_H * 0.55, 72), dark);
    base.position.y = PLAT_H * 0.275; base.receiveShadow = true; base.castShadow = true;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(PLAT_R, PLAT_R + 0.08, PLAT_H * 0.5, 72), metal);
    top.position.y = PLAT_H * 0.55 + PLAT_H * 0.25; top.receiveShadow = true;
    plat.add(base, top);
    // placas del borde (detalle tecnológico)
    const plateG = new THREE.BoxGeometry(0.22, PLAT_H * 0.42, 0.05);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const m = new THREE.Mesh(plateG, i % 3 ? metal : dark);
      m.position.set(Math.cos(a) * (PLAT_R + 0.2), PLAT_H * 0.3, Math.sin(a) * (PLAT_R + 0.2));
      m.rotation.y = -a + Math.PI / 2;
      plat.add(m);
    }
    // aros de luz (borde superior y zócalo)
    this.glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.glowMat2 = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.7 });
    const ring1 = new THREE.Mesh(new THREE.TorusGeometry(PLAT_R + 0.035, 0.016, 8, 128), this.glowMat);
    ring1.rotation.x = Math.PI / 2; ring1.position.y = PLAT_H + 0.005;
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(PLAT_R + 0.27, 0.01, 6, 128), this.glowMat2);
    ring2.rotation.x = Math.PI / 2; ring2.position.y = 0.02;
    plat.add(ring1, ring2);
    // superficie holográfica
    this.holo = holoMat();
    const holo = new THREE.Mesh(new THREE.CircleGeometry(PLAT_R - 0.02, 96), this.holo);
    holo.rotation.x = -Math.PI / 2; holo.position.y = PLAT_H + 0.006; holo.renderOrder = 3;
    plat.add(holo);
    // anillo exterior flotante de marcas que gira despacio
    this.orbit = new THREE.Group();
    const tickG = new THREE.BoxGeometry(0.1, 0.008, 0.02);
    for (let i = 0; i < 60; i++) {
      if (i % 10 > 6) continue;
      const a = (i / 60) * Math.PI * 2, m = new THREE.Mesh(tickG, this.glowMat2);
      m.position.set(Math.cos(a) * (PLAT_R + 0.55), 0, Math.sin(a) * (PLAT_R + 0.55)); m.rotation.y = -a;
      this.orbit.add(m);
    }
    this.orbit.position.y = 0.06;
    plat.add(this.orbit);
    // anillo de pulso (al cambiar de héroe sale de la plataforma)
    this.pulseMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    this.pulse = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 96), this.pulseMat);
    this.pulse.rotation.x = -Math.PI / 2; this.pulse.position.y = PLAT_H + 0.02;
    plat.add(this.pulse);
    // cono de luz volumétrica sobre la plataforma
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, PLAT_R * 0.98, 6, 48, 1, true), beamMat());
    this.beam.position.y = PLAT_H + 3; this.beam.renderOrder = 4;
    S.add(this.beam);

    // LUCES
    this.hemi = new THREE.HemisphereLight(0xbcc8e8, 0x0a0c14, 0.3);
    S.add(this.hemi);
    this.key = new THREE.SpotLight(0xfff2e2, 16, 18, 0.42, 0.55, 1.6);
    this.key.position.set(2.6, 5.2, 4.2);
    this.key.target.position.set(0, 1, 0);
    this.key.castShadow = !IS_TOUCH;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.bias = -0.0004; this.key.shadow.normalBias = 0.02;
    this.key.shadow.camera.near = 2; this.key.shadow.camera.far = 14;
    S.add(this.key, this.key.target);
    this.fill = new THREE.DirectionalLight(0x9fb4e0, 0.35);
    this.fill.position.set(-3, 2, 3);
    S.add(this.fill);
    this.rimL = new THREE.SpotLight(0xffffff, 26, 14, 0.5, 0.7, 1.4);
    this.rimL.position.set(-2.6, 3.6, -3.2); this.rimL.target.position.set(0, 1.1, 0);
    this.rimR = new THREE.SpotLight(0xffffff, 18, 14, 0.5, 0.7, 1.4);
    this.rimR.position.set(2.8, 2.8, -3); this.rimR.target.position.set(0, 1.1, 0);
    S.add(this.rimL, this.rimL.target, this.rimR, this.rimR.target);
    this.under = new THREE.PointLight(0xffffff, 3, 4, 1.6);
    this.under.position.set(0, PLAT_H + 0.25, 0.4);
    S.add(this.under);

    // PARTÍCULAS ambientales (suben despacio alrededor del héroe)
    const N = IS_TOUCH ? 140 : 260;
    const pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.6 + Math.random() * 3.2;
      pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = Math.random() * 4; pos[i * 3 + 2] = Math.sin(a) * r - 0.4;
      seed[i] = Math.random();
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    pg.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.parts = new THREE.Points(pg, new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uC: { value: new THREE.Color() }, uS: { value: 1 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      vertexShader: `attribute float seed; uniform float uT; uniform float uS; varying float vA;
        void main(){ vec3 p = position; float y = mod(p.y + uT * (0.12 + seed * 0.2), 4.0); p.y = y;
          p.x += sin(uT * 0.4 + seed * 20.0) * 0.12; p.z += cos(uT * 0.3 + seed * 13.0) * 0.12;
          vA = smoothstep(0.0, 0.6, y) * smoothstep(4.0, 2.6, y) * (0.35 + 0.65 * seed);
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_PointSize = uS * (2.0 + seed * 4.0) * (6.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uC; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vA; gl_FragColor = vec4(mix(uC, vec3(1.0), 0.5) * a, a); }`,
    }));
    this.parts.frustumCulled = false;
    S.add(this.parts);
  }

  // color de identidad del héroe (las luces y la plataforma se funden hacia él)
  setColor(hex) { this.colT.set(hex); }

  setHero(model, colorHex, { entrance = true } = {}) {
    if (this.hero && this.hero !== model && this.hero.root.parent === this.scene) this.scene.remove(this.hero.root);
    this.hero = model;
    if (!model) return;
    this.scene.add(model.root);
    model.setVisible(true);
    model.root.position.set(0, PLAT_H, 0);
    model.root.rotation.set(0, this.yaw, 0);
    model.root.scale.setScalar(1);
    this.setColor(colorHex);
    this.restPose(model);
    if (entrance) {
      this.enterK = 0; // entrada: sube de la plataforma (sin animar el cuerpo)
      this.pulseK = 1;
      this.yaw = this.baseYaw - 0.9; this.yawV = 0; this.idleT = 0;
    }
  }
  /* --- VIDA SUTIL: el héroe conserva su pose original (la de reposo de su esqueleto). Se mueven la cola y las
     orejas (balanceos y pequeñas sacudidas), la cabeza mira o se ladea de vez en cuando y el pecho respira;
     los brazos apenas acompañan la respiración y manos y pies no se mueven. --- */
  restPose(m) {
    // fuera las animaciones del juego: el esqueleto vuelve a su pose de reposo (la del modelo)
    if (m.mixer) m.mixer.stopAllAction();
    m.action = null; m.actionName = '';
    m.boneFx = m.armFx = m.tailFx = null;
    m.root.traverse((o) => { if (!o.isBone) return; const u = o.userData; if (u.q0) o.quaternion.copy(u.q0); if (u.s0) o.scale.copy(u.s0); if (u.p0) o.position.copy(u.p0); });
    const B = m.bones || {};
    const chain = (re) => Object.keys(B).filter((n) => re.test(n)).sort((a, b) => Number(a.match(/(\d+)$/)[1]) - Number(b.match(/(\d+)$/)[1])).map((n) => B[n]);
    const tail = chain(/^tail_(?:[a-z]+_)?\d+$/);
    const ears = { L: chain(/^ear_L_\d+$/), R: chain(/^ear_R_\d+$/) };
    // Ámbar no tiene cola ni orejas: solo las puntas de las alas se mecen muy levemente (como plumas al aire)
    const wings = tail.length || ears.L.length ? { L: [], R: [] } : { L: [B.wing_L_3, B.wing_L_4].filter(Boolean), R: [B.wing_R_3, B.wing_R_4].filter(Boolean) };
    // cabeza (miradas y ladeos suaves), respiración (pecho) y brazos casi quietos
    const body = { head: B.head, neck: B.neck, chest: B.chest, spine: B.spine, armL: B.upper_arm_L, armR: B.upper_arm_R };
    const all = [...tail, ...ears.L, ...ears.R, ...wings.L, ...wings.R, ...Object.values(body).filter(Boolean)];
    this.life0 = { body, look: { y: 0, x: 0, z: 0, ty: 0, tx: 0, tz: 0, t: 1.5 + Math.random() * 2 }, tail, ears, wings, q0: all.map((b) => b.quaternion.clone()), all, t: Math.random() * 10,
      flick: 0, flickT: 2 + Math.random() * 3, flickDir: 1, twitch: { L: 0, R: 0 }, twitchT: 1.5 + Math.random() * 2.5 };
  }
  life(dt) {
    const L = this.life0;
    if (!L) return;
    L.t += dt;
    const t = L.t;
    L.all.forEach((b, i) => b.quaternion.copy(L.q0[i]));
    // COLA: balanceo lento y suave (la onda baja por la cola) y, de vez en cuando, un pequeño coletazo
    L.flickT -= dt;
    if (L.flickT <= 0) { L.flickT = 3 + Math.random() * 4.5; L.flick = 1; L.flickDir = Math.random() < 0.5 ? -1 : 1; }
    L.flick = Math.max(0, L.flick - dt * 0.9);
    const n = L.tail.length;
    L.tail.forEach((b, i) => {
      const k = (i + 1) / Math.max(1, n), lag = i * 0.55;
      const sway = 0.06 * Math.sin(t * 0.9 - lag) * (0.5 + 0.5 * k);
      const fl = L.flick > 0 ? 0.2 * L.flickDir * Math.sin((1 - L.flick) * Math.PI * 2.2 - lag) * L.flick * (0.4 + 0.6 * k) : 0;
      rotAdd(b, _Y, sway + fl);
      rotAdd(b, _X, 0.02 * Math.sin(t * 0.6 - lag));
    });
    // OREJAS: quietas casi siempre; de vez en cuando una (o las dos) da una sacudida corta hacia atrás
    L.twitchT -= dt;
    if (L.twitchT <= 0) {
      L.twitchT = 1.8 + Math.random() * 3.5;
      const r = Math.random();
      if (r < 0.4) L.twitch.L = 1; else if (r < 0.8) L.twitch.R = 1; else { L.twitch.L = 1; L.twitch.R = 0.85; }
    }
    for (const side of ['L', 'R']) {
      L.twitch[side] = Math.max(0, L.twitch[side] - dt * 3.2);
      const w = L.twitch[side], e = w > 0 ? Math.sin((1 - w) * Math.PI) : 0; // sube y vuelve en ~0,3 s
      const sg = side === 'L' ? 1 : -1;
      L.ears[side].forEach((b, i) => {
        const k = i === 0 ? 1 : 0.6;
        rotAdd(b, _X, (0.22 * e + 0.012 * Math.sin(t * 1.3 + i)) * k);
        rotAdd(b, _Z, sg * 0.1 * e * k);
        rotAdd(b, _Y, sg * (0.03 * Math.sin(t * 0.7 + (side === 'L' ? 0 : 2)) + 0.12 * e) * k); // las orejas se orientan un poco
      });
    }
    // CABEZA: de vez en cuando mira un poco a un lado, ladea la cabeza o vuelve al frente (giros pequeños y lentos)
    const lk = L.look, bd = L.body;
    lk.t -= dt;
    if (lk.t <= 0) {
      lk.t = 2.2 + Math.random() * 3.5;
      const r = Math.random();
      if (r < 0.35) { lk.ty = 0; lk.tx = 0; lk.tz = 0; }                                          // al frente
      else if (r < 0.75) { lk.ty = (Math.random() < 0.5 ? -1 : 1) * (0.08 + Math.random() * 0.1); lk.tx = (Math.random() - 0.5) * 0.06; lk.tz = 0; } // mira a un lado
      else { lk.ty = (Math.random() - 0.5) * 0.06; lk.tx = -0.03; lk.tz = (Math.random() < 0.5 ? -1 : 1) * (0.06 + Math.random() * 0.05); } // ladea la cabeza (curiosidad)
    }
    const kk = 1 - Math.exp(-dt * 2.2);
    lk.y += (lk.ty - lk.y) * kk; lk.x += (lk.tx - lk.x) * kk; lk.z += (lk.tz - lk.z) * kk;
    const breath = Math.sin(t * 1.7);
    if (bd.neck) { rotAdd(bd.neck, _Y, lk.y * 0.35); rotAdd(bd.neck, _X, lk.x * 0.3); }
    if (bd.head) { rotAdd(bd.head, _Y, lk.y * 0.65); rotAdd(bd.head, _X, lk.x * 0.7 + 0.008 * breath); rotAdd(bd.head, _Z, lk.z); }
    // RESPIRACIÓN: el pecho sube y baja muy poco
    if (bd.chest) rotAdd(bd.chest, _X, -0.012 * breath);
    if (bd.spine) rotAdd(bd.spine, _X, -0.005 * breath);
    // BRAZOS: prácticamente quietos (solo acompañan la respiración); manos y pies no se mueven
    if (bd.armL) rotAdd(bd.armL, _Z, 0.006 * breath);
    if (bd.armR) rotAdd(bd.armR, _Z, -0.006 * breath);
    // ÁMBAR: las puntas de las alas apenas se mecen
    for (const side of ['L', 'R']) {
      const sg = side === 'L' ? 1 : -1;
      L.wings[side].forEach((b, i) => rotAdd(b, _Z, sg * 0.02 * Math.sin(t * 0.8 + i * 0.6 + (side === 'L' ? 0 : 1.3))));
    }
  }

  // al salir de la pantalla: el modelo vuelve al juego tal como estaba
  release() {
    const m = this.hero;
    if (m && this.life0) this.life0.all.forEach((b, i) => b.quaternion.copy(this.life0.q0[i]));
    this.life0 = null;
    if (m) { if (m.root.parent === this.scene) this.scene.remove(m.root); m.root.scale.setScalar(1); m.root.rotation.set(0, 0, 0); }
    this.hero = null;
  }

  // arrastrar para girar (ratón o dedo)
  drag(dx) { this.yawV = dx * 0.012 / Math.max(1e-3, 1 / 60); this.yaw += dx * 0.012; this.idleT = 0; this.dragging = true; }
  endDrag() { this.dragging = false; }

  setSize(w, h) { this.w = w; this.h = h; }
  // hueco libre (fracciones de la pantalla) donde debe quedar el héroe entero
  setView(v) { Object.assign(this.view, v); }

  frame() {
    const m = this.hero, cam = this.camera, W = this.w, H = this.h;
    const hh = m ? (m.height || 1.8) : 1.8;
    const v = this.view;
    const bw = Math.max(0.2, v.right - v.left), bh = Math.max(0.2, v.bottom - v.top);
    cam.aspect = W / H;
    // el héroe entero (con la plataforma) ocupa el 78 % del alto libre, sin cortar cabeza ni pies
    const tH = Math.tan((cam.fov * Math.PI) / 360);
    const needH = hh * 1.16 + PLAT_H + 0.12;
    const needW = Math.max(1.0, hh * 0.8);
    const dH = needH / (2 * tH * bh);
    const dW = needW / (2 * tH * cam.aspect * bw);
    const d = Math.max(dH, dW, 2.0);
    const cy = (PLAT_H + hh * 1.12) * 0.5 + 0.02;
    const sway = Math.sin(this.t * 0.25) * 0.06;
    cam.position.set(Math.sin(sway) * d, cy + d * 0.07, Math.cos(sway) * d);
    cam.lookAt(0, cy, 0);
    // desplaza el encuadre para que el centro del héroe caiga en el centro del hueco libre
    const cx = (v.left + v.right) / 2, cyF = (v.top + v.bottom) / 2;
    cam.setViewOffset(W, H, (0.5 - cx) * W, (0.5 - cyF) * H, W, H);
    cam.updateProjectionMatrix();
  }

  update(dt) {
    this.t += dt;
    const t = this.t;
    // color de identidad (transición suave)
    this.col.lerp(this.colT, Math.min(1, dt * 4));
    const c = this.col;
    this.holo.uniforms.uC.value.copy(c); this.holo.uniforms.uT.value = t;
    this.beam.material.uniforms.uC.value.copy(c); this.beam.material.uniforms.uT.value = t;
    this.sky.material.uniforms.uC.value.copy(c); this.sky.material.uniforms.uT.value = t;
    this.grid.material.uniforms.uC.value.copy(c);
    this.parts.material.uniforms.uC.value.copy(c); this.parts.material.uniforms.uT.value = t;
    this.parts.material.uniforms.uS.value = this.renderer.getPixelRatio();
    this.glowMat.color.copy(c).multiplyScalar(2.6);
    this.glowMat2.color.copy(c).multiplyScalar(1.6);
    this.rimL.color.copy(c).lerp(WHITE, 0.5);
    this.rimR.color.copy(c).lerp(WHITE, 0.8);
    this.under.color.copy(c).lerp(WHITE, 0.4);
    this.orbit.rotation.y = t * 0.12;
    this.bgMat.color.copy(c).multiplyScalar(0.9);
    this.haloMat.color.copy(c);
    this.halo.rotation.z = t * 0.03; this.haloArcs[0].rotation.z = -t * 0.08; this.haloArcs[1].rotation.z = t * 0.05;
    this.rayMat.uniforms.uC.value.copy(c); this.rayMat.uniforms.uK.value = 0.07 + 0.02 * Math.sin(t * 0.5);
    this.pool.material.uniforms.uC.value.copy(c);
    // pulso al cambiar de héroe
    if (this.pulseK > 0) {
      this.pulseK = Math.max(0, this.pulseK - dt * 1.6);
      const k = 1 - this.pulseK;
      this.pulse.scale.setScalar(PLAT_R * (0.3 + 2.4 * k));
      this.pulseMat.color.copy(c).multiplyScalar(2);
      this.pulseMat.opacity = this.pulseK * 0.9;
      this.holo.uniforms.uPulse.value = this.pulseK;
    } else this.holo.uniforms.uPulse.value = 0;
    // la luz volumétrica respira y destella con la entrada
    this.beam.material.uniforms.uK.value = 0.13 + 0.02 * Math.sin(t * 1.3) + (this.pulseK || 0) * 0.35;
    this.under.intensity = 0.9 + 0.2 * Math.sin(t * 2) + (this.pulseK || 0) * 5;

    const m = this.hero;
    if (m) {
      // entrada: sube desde la plataforma con un leve rebote
      if (this.enterK < 1) {
        this.enterK = Math.min(1, this.enterK + dt / 0.55);
        const k = this.enterK, e = 1 - Math.pow(1 - k, 3);
        m.root.position.y = PLAT_H - 0.35 * (1 - e);
        const s = 0.9 + 0.1 * e + 0.03 * Math.sin(k * Math.PI);
        m.root.scale.set(s, s, s);
      } else { m.root.position.y = PLAT_H; m.root.scale.setScalar(1); }
      // giro: arrastre con inercia y, tras unos segundos sin tocar, vuelve despacio a mirar a cámara
      if (!this.dragging) {
        this.yaw += this.yawV * dt;
        this.yawV *= Math.pow(0.04, dt);
        this.idleT += dt;
        if (this.idleT > 2.5 && Math.abs(this.yawV) < 0.2) {
          let d = this.baseYaw - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
          this.yaw += d * Math.min(1, dt * 1.2);
        } else if (this.enterK < 1 || this.idleT < 1.2) {
          let d = this.baseYaw - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
          this.yaw += d * Math.min(1, dt * 3);
        }
      } else this.yawV *= 0.8;
      m.root.rotation.y = this.yaw;
      // animación de presentación (su animación de poder) y después reposo
      this.life(dt);
    }
    this.frame();
  }
}
