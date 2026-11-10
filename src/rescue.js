import * as THREE from 'three';

/* ======================================================================
   RESCATE CON BURBUJAS DE ENERGÍA
   Sustituye al antiguo "cargar a la víctima" (que la colgaba del cuerpo del héroe).
   · Cada víctima rescatada tiene SU PROPIA burbuja: solo la envuelve a ella (el héroe nunca entra; su escudo
     original no se toca, son cosas independientes).
   · La burbuja se ajusta al tamaño de cada modelo (persona, niño, anciano, perro, gato, ciervo...).
   · Sigue al héroe por el MISMO camino que él ha recorrido (migas de pan), así no atraviesa paredes, y se
     mueve con un muelle amortiguado: sin tirones ni vibraciones. Con varias burbujas, van en fila.
   · Al entregar en el Centro de Vida la burbuja se expande, se desvanece y suelta a la víctima.
   La lista lógica de rescatados sigue siendo player.carrying (contador, capacidad, portal y entrega igual).
   ====================================================================== */

const TAU = Math.PI * 2;
const HOVER = 0.3;          // la burbuja flota a esta altura sobre el suelo
const GAP = 0.3;            // separación entre burbujas en la fila
const STIFF = 26, DAMP = 2 * Math.sqrt(26); // muelle críticamente amortiguado (sin rebotes ni vibración)

const bubbleGeo = new THREE.SphereGeometry(1, 48, 32);
function bubbleMat() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uT: { value: 0 }, uA: { value: 0 }, uFlash: { value: 0 } },
    vertexShader: `uniform float uT; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        vP = position;
        vec3 p = position * (1.0 + 0.012 * sin(uT * 3.0 + position.y * 6.0)); // la superficie respira apenas
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform float uT; uniform float uA; uniform float uFlash; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float rim = pow(f, 2.6);
        // reflejos irisados (cian → violeta → dorado) que giran despacio por la superficie
        float h = f * 2.2 + vP.y * 1.5 + uT * 0.25;
        vec3 iri = 0.5 + 0.5 * cos(6.2831 * (h + vec3(0.0, 0.33, 0.67)));
        vec3 c = mix(vec3(0.55, 0.9, 1.0), iri, 0.35) * (0.9 + 0.5 * rim);
        // ondas de energía finas que suben
        float wave = smoothstep(0.92, 1.0, sin(vP.y * 14.0 - uT * 3.0) * 0.5 + 0.5) * 0.25;
        // brillo especular fijo (da volumen de pompa)
        float spec = smoothstep(0.975, 1.0, dot(normalize(vP), normalize(vec3(-0.4, 0.7, 0.55))));
        float a = (0.05 + rim * 0.62 + wave * (0.3 + rim) + spec * 0.55 + uFlash * 0.4) * uA; // centro casi transparente
        gl_FragColor = vec4(c + spec + uFlash * 0.6, clamp(a, 0.0, 0.9));
      }`,
  });
}

export class RescueBubbles {
  constructor(game) {
    this.g = game;
    this.list = [];          // { v, r, mesh, mat, pos, vel, t, born, yaw }
    this.path = [];          // camino del héroe (más reciente al final)
  }
  has(v) { return this.list.some((b) => b.v === v); }

  // tamaño de la burbuja a partir del modelo real de la víctima (en reposo, sin girar)
  // Se mide ya en la postura que tendrá dentro de la burbuja (brazos, bastón...): radio = punto más lejano del
  // cuerpo respecto al eje vertical de la víctima (así girar o balancearse no la saca de la burbuja).
  measure(v) {
    const root = v.root, rot = root.rotation.clone();
    if (v.update) v.update(0); // aplica la postura 'carried'
    root.rotation.set(0, 0, 0);
    root.updateMatrixWorld(true);
    // solo el cuerpo: sin el marcador "!" que flota encima ni otros sprites
    const box = new THREE.Box3(), tmp = new THREE.Box3();
    root.traverse((o) => {
      if (!o.isMesh || o.isSprite || o === v.marker || !o.visible) return;
      for (let q = o; q && q !== root; q = q.parent) if (q === v.marker || q.isSprite) return;
      o.geometry.computeBoundingBox();
      tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      box.union(tmp);
    });
    const s = box.isEmpty() ? new THREE.Vector3(0.5, v.height || 1, 0.5) : box.getSize(new THREE.Vector3());
    const o = root.getWorldPosition(new THREE.Vector3());
    const cy = box.isEmpty() ? s.y / 2 : (box.min.y + box.max.y) / 2 - o.y; // altura del centro sobre los pies
    let far = 0;
    const p = new THREE.Vector3(), c = new THREE.Vector3(o.x, o.y + cy, o.z);
    root.traverse((m) => {
      if (!m.isMesh || m === v.marker || !m.visible) return;
      for (let q = m; q && q !== root; q = q.parent) if (q === v.marker || q.isSprite) return;
      const P = m.geometry.attributes.position;
      for (let i = 0; i < P.count; i++) { p.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld); far = Math.max(far, p.distanceTo(c)); }
    });
    root.rotation.copy(rot);
    const h = cy * 2;
    return { h, r: Math.max(far, s.y * 0.5) + 0.14 }; // 14 cm de margen: el balanceo nunca la saca
  }

  // F junto a una víctima: la burbuja nace alrededor de ella
  add(v) {
    if (this.has(v)) return null;
    const { h, r } = this.measure(v);
    const mat = bubbleMat();
    const mesh = new THREE.Mesh(bubbleGeo, mat);
    mesh.renderOrder = 7;
    mesh.frustumCulled = false;
    this.g.scene.attach(v.root); // la víctima es independiente del héroe
    v.root.scale.set(1, 1, 1);
    v.root.rotation.set(0, v.root.rotation.y, 0);
    const base = new THREE.Vector3();
    v.root.getWorldPosition(base);
    const pos = base.clone(); pos.y += h * 0.5 + HOVER * 0.4;
    mesh.position.copy(pos); mesh.scale.setScalar(0.001);
    this.g.scene.add(mesh);
    const b = { v, r, h, mesh, mat, pos, vel: new THREE.Vector3(), t: 0, yaw: v.root.rotation.y, ph: Math.random() * TAU, lift: 0 };
    this.list.push(b);
    // destello de energía al activarse
    const vfx = this.g.vfx, fx = this.g.fx;
    vfx.ring(base.x, base.y + 0.05, base.z, { r0: 0.2, r1: r * 2.2, dur: 0.45, color: 0x9ae8ff, opacity: 0.75 });
    vfx.ring(pos.x, pos.y, pos.z, { r0: 0.1, r1: r * 1.6, dur: 0.35, color: 0xffffff, opacity: 0.5 });
    for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU; fx.sparkle(pos.x + Math.cos(a) * r, pos.y + (Math.random() - 0.5) * r, pos.z + Math.sin(a) * r, i % 2 ? 0x9ae8ff : 0xffffff, 1.6); }
    return b;
  }

  // entrega: la burbuja se expande, destella y desaparece; la víctima baja al suelo
  release(v, groundY) {
    const i = this.list.findIndex((b) => b.v === v);
    if (i < 0) return;
    const b = this.list[i];
    this.list.splice(i, 1);
    const vfx = this.g.vfx, fx = this.g.fx, p = b.mesh.position.clone(), r = b.r, mesh = b.mesh, mat = b.mat;
    v.root.position.set(p.x, groundY, p.z);
    v.root.rotation.set(0, b.yaw, 0);
    vfx.ring(p.x, groundY + 0.05, p.z, { r0: 0.3, r1: r * 2.6, dur: 0.5, color: 0x9ae8ff, opacity: 0.7 });
    for (let k = 0; k < 18; k++) { const a = Math.random() * TAU, e = Math.random() * Math.PI; fx.sparkle(p.x + Math.cos(a) * Math.sin(e) * r, p.y + Math.cos(e) * r, p.z + Math.sin(a) * Math.sin(e) * r, k % 3 ? 0x9ae8ff : 0xffe070, 2.2); }
    // la burbuja ya no sigue a nadie: se hincha y se desvanece en 0,45 s (vfx la retira y libera su material)
    this.g.scene.remove(mesh);
    mesh.userData.own = true;
    const life = 0.45, a0 = mat.uniforms.uA.value;
    vfx.add(mesh, life, (it) => {
      const k = it.t / life;
      mat.uniforms.uT.value += 0.016;
      mat.uniforms.uFlash.value = Math.max(0, 1 - k * 2);
      mat.uniforms.uA.value = a0 * (1 - k * k);
      mesh.scale.setScalar(r * (1 + 0.35 * Math.sin(k * Math.PI * 0.5)));
    });
  }

  clear() {
    for (const b of this.list) { this.g.scene.remove(b.mesh); b.mat.dispose(); }
    this.list.length = 0;
    this.path.length = 0;
  }

  // punto del camino del héroe a `dist` metros por detrás de él (siguiendo sus pasos)
  pointBack(dist, out) {
    const P = this.path, p = this.g.player.pos;
    let prev = p, left = dist;
    for (let i = P.length - 1; i >= 0; i--) {
      const q = P[i], d = prev.distanceTo(q);
      if (d >= left) return out.copy(prev).lerp(q, left / Math.max(d, 1e-6));
      left -= d; prev = q;
    }
    // camino aún corto: detrás del héroe, en la dirección contraria a la que mira
    const f = this.g.player.facing;
    return out.set(prev.x - Math.sin(f) * left, prev.y, prev.z - Math.cos(f) * left);
  }

  update(dt) {
    const pl = this.g.player, p = pl.pos;
    // migas de pan: el camino real del héroe (solo mientras haya burbujas)
    if (!this.list.length) { this.path.length = 0; return; }
    const last = this.path[this.path.length - 1];
    if (!last || last.distanceTo(p) > 0.15) { this.path.push(p.clone()); if (this.path.length > 400) this.path.shift(); }
    let along = (pl.R || 0.35) + 0.45;
    const tgt = new THREE.Vector3();
    this.list.forEach((b, i) => {
      b.t += dt;
      along += b.r + (i ? this.list[i - 1].r + GAP : 0);
      this.pointBack(along, tgt);
      const ground = pl.floorY ? pl.floorY(tgt.x, tgt.z, tgt.y + 1) : tgt.y;
      tgt.y = Math.max(ground, Math.min(tgt.y, ground + 30)) + HOVER + b.r; // flota sobre el suelo (o sobre el héroe si vuela)
      if (pl.fly || !pl.grounded) tgt.y = Math.max(tgt.y, p.y + b.r * 0.6);
      // nunca encima del héroe: si queda demasiado cerca, se aparta en horizontal
      const dx = tgt.x - p.x, dz = tgt.z - p.z, dd = Math.hypot(dx, dz), minD = (pl.R || 0.35) + b.r + 0.25;
      if (dd < minD) { const k = dd > 1e-3 ? minD / dd : 1; tgt.x = p.x + (dd > 1e-3 ? dx * k : -Math.sin(pl.facing) * minD); tgt.z = p.z + (dd > 1e-3 ? dz * k : -Math.cos(pl.facing) * minD); }
      // muelle amortiguado hacia el objetivo
      const ax = (tgt.x - b.pos.x) * STIFF - b.vel.x * DAMP, ay = (tgt.y - b.pos.y) * STIFF - b.vel.y * DAMP, az = (tgt.z - b.pos.z) * STIFF - b.vel.z * DAMP;
      b.vel.x += ax * dt; b.vel.y += ay * dt; b.vel.z += az * dt;
      b.pos.addScaledVector(b.vel, dt);
      // regla firme: el héroe nunca entra en la burbuja; si camina hacia ella, la empuja (como a una pompa)
      const ex = b.pos.x - p.x, ez = b.pos.z - p.z, ed = Math.hypot(ex, ez), minH = (pl.R || 0.35) + b.r + 0.05;
      if (ed < minH && Math.abs(b.pos.y - (p.y + (pl.H || 1.6) * 0.5)) < b.r + (pl.H || 1.6) * 0.5) {
        const ux = ed > 1e-3 ? ex / ed : -Math.sin(pl.facing), uz = ed > 1e-3 ? ez / ed : -Math.cos(pl.facing);
        b.pos.x = p.x + ux * minH; b.pos.z = p.z + uz * minH;
        const vn = b.vel.x * ux + b.vel.z * uz; if (vn < 0) { b.vel.x -= vn * ux; b.vel.z -= vn * uz; } // sin rebote hacia el héroe
      }
      // aparición progresiva (0,35 s, con un pequeño rebote)
      const k = Math.min(1, b.t / 0.35), grow = k < 1 ? 1 - Math.pow(1 - k, 3) * Math.cos(k * 4) : 1;
      const bob = Math.sin(b.t * 2.2 + b.ph) * 0.05;
      b.mesh.position.set(b.pos.x, b.pos.y + bob * 0.5, b.pos.z);
      b.mesh.scale.setScalar(Math.max(0.001, b.r * grow * (1 + 0.015 * Math.sin(b.t * 3 + b.ph))));
      b.mat.uniforms.uT.value = b.t;
      b.mat.uniforms.uA.value = Math.min(1, b.t / 0.3);
      b.mat.uniforms.uFlash.value = Math.max(0, 1 - b.t / 0.4);
      // la víctima flota dentro, centrada; mira suavemente hacia donde avanza
      const sp = Math.hypot(b.vel.x, b.vel.z);
      if (sp > 0.4) { const want = Math.atan2(b.vel.x, b.vel.z); let d = want - b.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); b.yaw += d * Math.min(1, dt * 4); }
      const v = b.v;
      v.root.position.set(b.pos.x, b.pos.y + bob - b.h * 0.5, b.pos.z);
      v.root.rotation.set(Math.sin(b.t * 1.7 + b.ph) * 0.06, b.yaw, Math.sin(b.t * 1.3 + b.ph) * 0.05);
    });
  }
}
