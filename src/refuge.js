import * as THREE from 'three';
import { makeCanvas, texFromCanvas, TAU } from './utils.js';
import { CFG } from './terrain.js';

const STYLES = {
  camp: { sign: 'REFUGIO  +', signBg: '#11803f', disc: 0xa8aaa8, tents: [0xf0f0e8, 0xe8853a, 0xf0f0e8], extra: null },
  bunker: { sign: 'REFUGIO VOLCÁN', signBg: '#8a2a10', disc: 0x55504a, tents: [0xc9c0b0, 0xe8853a, 0xc9c0b0], extra: 'bunker' },
  shelter: { sign: 'REFUGIO HURACÁN', signBg: '#0d5a8a', disc: 0xb4b8b8, tents: [0xf0f0e8, 0x2e86c1, 0xf0f0e8], extra: 'lighthouse' },
  oasis: { sign: 'REFUGIO OASIS', signBg: '#8a6a10', disc: 0xc9b48a, tents: [0xe8d8b0, 0xc0392b, 0xe8d8b0], extra: 'palms' },
  lodge: { sign: 'REFUGIO MONTAÑA', signBg: '#1a4a6a', disc: 0xcfd8e2, tents: [0xf0f4f8, 0xd8452a, 0xf0f4f8], extra: 'lodge' },
  farm: { sign: 'REFUGIO + AGUA', signBg: '#1a6a3a', disc: 0xb8aa88, tents: [0xf0f0e0, 0x2e86c1, 0xf0f0e0], extra: 'tank' },
  quake: { sign: 'ZONA SEGURA', signBg: '#11803f', disc: 0xa8aaa8, tents: [0xf0f0e8, 0xe8853a, 0xf0f0e8], extra: null },
};

export function buildRefuge(scene, addSolid, styleName = 'camp') {
  const st = STYLES[styleName] || STYLES.camp;
  const S0 = CFG.SAFE;
    const safe = new THREE.Group();
    safe.position.set(S0.x, S0.y, S0.z);
    scene.add(safe);
    const cyM = (r, h, col, o = {}) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 24), new THREE.MeshStandardMaterial({ color: col, roughness: 0.8, ...o }));
    const disc = cyM(9, 0.3, st.disc);
    disc.position.y = -0.1;
    disc.receiveShadow = true;
    safe.add(disc);
    // tiendas
    const tentMat = st.tents;
    [[-6.5, -3], [-6.5, 3], [6.5, 3.5]].forEach(([x, z], i) => {
      const t = new THREE.Mesh(new THREE.ConeGeometry(2.6, 2.4, 4), new THREE.MeshStandardMaterial({ color: tentMat[i], roughness: 0.9 }));
      t.position.set(x, 1.4, z);
      t.rotation.y = Math.PI / 4;
      t.castShadow = true;
      safe.add(t);
      const base = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.5, 3.4), new THREE.MeshStandardMaterial({ color: tentMat[i], roughness: 0.9 }));
      base.position.set(x, 0.2, z);
      base.rotation.y = Math.PI / 4;
      safe.add(base);
    });
    // ambulancia
    const amb = new THREE.Group();
    amb.position.set(5.5, 0, -4);
    amb.rotation.y = -0.4;
    safe.add(amb);
    const ab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.8, 4.2), new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.4 }));
    ab.position.y = 1.15;
    ab.castShadow = true;
    amb.add(ab);
    const ac = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.5, 1.4), new THREE.MeshStandardMaterial({ color: 0xd42020, roughness: 0.4 }));
    ac.position.set(0, 1.1, 0.4);
    amb.add(ac);
    const light = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.18, 0.3), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2020).multiplyScalar(3) }));
    light.position.set(0, 2.15, 1.3);
    amb.add(light);
    const cross = new THREE.Mesh(new THREE.BoxGeometry(2.06, 0.7, 0.16), new THREE.MeshBasicMaterial({ color: 0xd42020 }));
    cross.position.set(0, 1.3, -1.5);
    amb.add(cross);
    const wheelM = new THREE.MeshStandardMaterial({ color: 0x151515 });
    for (const [x, z] of [[-0.95, 1.4], [0.95, 1.4], [-0.95, -1.4], [0.95, -1.4]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.3, 14), wheelM);
      w.rotation.z = Math.PI / 2;
      w.position.set(x, 0.4, z);
      amb.add(w);
    }
    addSolid(S0.x + 4.4, S0.x + 6.6, S0.y - 1, S0.y + 2.2, S0.z - 6.2, S0.z - 1.8, 'ambulance');
    // helicóptero
    const heli = new THREE.Group();
    heli.position.set(-2.5, 0, -6.5);
    heli.rotation.y = 0.5;
    safe.add(heli);
    const hb = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 12), new THREE.MeshStandardMaterial({ color: 0xd42a20, roughness: 0.35, metalness: 0.3 }));
    hb.scale.set(1, 0.9, 1.6);
    hb.position.y = 1.5;
    hb.castShadow = true;
    heli.add(hb);
    const hg = new THREE.Mesh(new THREE.SphereGeometry(1.0, 12, 10), new THREE.MeshStandardMaterial({ color: 0x223a4a, roughness: 0.05, metalness: 0.9 }));
    hg.scale.set(1, 0.85, 1);
    hg.position.set(0, 1.75, 1.2);
    heli.add(hg);
    const boom = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 4), new THREE.MeshStandardMaterial({ color: 0xd42a20 }));
    boom.position.set(0, 1.7, -3.4);
    boom.castShadow = true;
    heli.add(boom);
    const rotor = new THREE.Group();
    rotor.position.set(0, 2.8, 0);
    heli.add(rotor);
    for (let i = 0; i < 2; i++) {
      const bl = new THREE.Mesh(new THREE.BoxGeometry(9, 0.05, 0.35), new THREE.MeshStandardMaterial({ color: 0x222222 }));
      bl.rotation.y = i * Math.PI / 2;
      rotor.add(bl);
    }
    const tailRotor = new THREE.Group();
    tailRotor.position.set(0.25, 2.0, -5.3);
    heli.add(tailRotor);
    tailRotor.add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.6, 0.2), new THREE.MeshStandardMaterial({ color: 0x222222 })));
    for (const x of [-0.9, 0.9]) {
      const sk = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 3.2), new THREE.MeshStandardMaterial({ color: 0x222222 }));
      sk.position.set(x, 0.15, 0.2);
      heli.add(sk);
    }
    addSolid(S0.x - 4.6, S0.x - 0.6, S0.y - 1, S0.y + 3, S0.z - 8.6, S0.z - 4.4, 'heli');
    // bandera y cartel
    const pole = cyM(0.08, 7, 0xdddddd);
    pole.position.set(0, 3.5, 6);
    safe.add(pole);
    const flagGeo = new THREE.PlaneGeometry(2.6, 1.5, 12, 4);
    const flag = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ color: 0x2ecc71, side: THREE.DoubleSide, roughness: 0.7, emissive: 0x0a4a20, emissiveIntensity: 0.4 }));
    flag.position.set(1.4, 6.0, 6);
    safe.add(flag);
    const cv = makeCanvas(512, 128);
    const cg = cv.getContext('2d');
    cg.fillStyle = st.signBg;
    cg.fillRect(0, 0, 512, 128);
    cg.fillStyle = '#fff';
    cg.font = 'bold 64px sans-serif';
    cg.textAlign = 'center';
    cg.textBaseline = 'middle';
    cg.fillText(st.sign, 256, 68);
    const signB = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshBasicMaterial({ map: texFromCanvas(cv), toneMapped: false }));
    signB.position.set(0, 3.4, 8.2);
    safe.add(signB);
    const signP = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.2, 0.2), new THREE.MeshStandardMaterial({ color: 0x223322 }));
    signP.position.set(0, 3.4, 8.08);
    safe.add(signP);
    // baliza
    const beaconMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: `varying vec2 vUv; uniform float uTime; void main(){ float a = pow(1.0-vUv.y,1.6)*0.5*(0.75+0.25*sin(uTime*2.0+vUv.y*10.0)); gl_FragColor=vec4(vec3(0.2,1.0,0.6)*2.0,a); }`,
    });
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.6, 55, 24, 1, true), beaconMat);
    beacon.position.set(0, 27.5, 0);
    safe.add(beacon);
    const ring = new THREE.Mesh(new THREE.RingGeometry(7.4, 8, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x30ff90).multiplyScalar(1.6), transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08;
    safe.add(ring);
    const safeLight = new THREE.PointLight(0x40ffa0, 4, 30, 1.6);
    safeLight.position.set(0, 3, 0);
    safe.add(safeLight);
  const eg = st.extra;
  if (eg === 'bunker') {
    const bk = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 5), new THREE.MeshStandardMaterial({ color: 0x6a655c, roughness: 0.9 }));
    bk.position.set(-2, 1.5, 4.5);
    bk.castShadow = true;
    safe.add(bk);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.2, 0.15), new THREE.MeshStandardMaterial({ color: 0x2a3a4a, metalness: 0.8, roughness: 0.4 }));
    door.position.set(-2, 1.1, 2.02);
    safe.add(door);
    addSolid(S0.x - 5, S0.x + 1, S0.y - 1, S0.y + 3, S0.z + 2, S0.z + 7, 'bunker');
  } else if (eg === 'lighthouse') {
    const lh = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2, 12, 16), new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.6 }));
    lh.position.set(-5, 6, 5);
    lh.castShadow = true;
    safe.add(lh);
    for (let i = 0; i < 3; i++) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(1.62 - i * 0.12, 1.66 - i * 0.12, 1.2, 16), new THREE.MeshStandardMaterial({ color: 0xc0392b }));
      band.position.set(-5, 2 + i * 3.6, 5);
      safe.add(band);
    }
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff2a0).multiplyScalar(3) }));
    lamp.position.set(-5, 12.6, 5);
    safe.add(lamp);
    addSolid(S0.x - 6.5, S0.x - 3.5, S0.y - 1, S0.y + 12, S0.z + 3.5, S0.z + 6.5, 'lighthouse');
  } else if (eg === 'lodge') {
    const lg = new THREE.Mesh(new THREE.BoxGeometry(8, 3.4, 5), new THREE.MeshStandardMaterial({ color: 0x7a4a2a, roughness: 0.9 }));
    lg.position.set(-2, 1.7, 5.5);
    lg.castShadow = true;
    safe.add(lg);
    const rf = new THREE.Mesh(new THREE.ConeGeometry(6.4, 2.2, 4), new THREE.MeshStandardMaterial({ color: 0xeef3f8, roughness: 0.9 }));
    rf.position.set(-2, 4.5, 5.5);
    rf.rotation.y = Math.PI / 4;
    safe.add(rf);
    addSolid(S0.x - 6, S0.x + 2, S0.y - 1, S0.y + 3.4, S0.z + 3, S0.z + 8, 'lodge');
  } else if (eg === 'tank') {
    const tk = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 4.4, 18), new THREE.MeshStandardMaterial({ color: 0x8a9aaa, metalness: 0.5, roughness: 0.5 }));
    tk.position.set(-5, 2.2, 5);
    tk.castShadow = true;
    safe.add(tk);
    const wt = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.3, 18), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x40b0ff).multiplyScalar(1.5) }));
    wt.position.set(-5, 4.5, 5);
    safe.add(wt);
    addSolid(S0.x - 7, S0.x - 3, S0.y - 1, S0.y + 4.4, S0.z + 3, S0.z + 7, 'tank');
  } else if (eg === 'palms') {
    for (const [px, pz] of [[-6, 4], [6.5, 5.5], [-1, 8]]) {
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 5, 8), new THREE.MeshStandardMaterial({ color: 0x8a6a3a }));
      tr.position.set(px, 2.5, pz);
      safe.add(tr);
      for (let k = 0; k < 6; k++) {
        const fr = new THREE.Mesh(new THREE.ConeGeometry(0.3, 2.6, 4), new THREE.MeshStandardMaterial({ color: 0x3a8a3a }));
        const a = k * 1.05;
        fr.position.set(px + Math.cos(a) * 1.2, 5.1, pz + Math.sin(a) * 1.2);
        fr.rotation.set(Math.sin(a) * 1.2, 0, -Math.cos(a) * 1.2);
        safe.add(fr);
      }
    }
  }
  return { group: safe, rotor, tailRotor, flag, ring, beaconMat, safeLight };
}
