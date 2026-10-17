import * as THREE from 'three';

// PIEZAS VISUALES de los ataques de jefe (solo mallas, sin lógica): muros de piedra, tentáculos,
// nubes de tormenta, estatuas, serpientes y la textura espiral del remolino.

const TAU = Math.PI * 2;
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0.02, flatShading: true, ...o });

export function makeWall(len, thick, h, color = 0x8a7a62) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(len, h, thick), std(color));
  body.position.y = h / 2;
  body.castShadow = body.receiveShadow = true;
  g.add(body);
  for (let i = 0; i < Math.max(2, Math.round(len / 3)); i++) { // piedras salientes en lo alto
    const r = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45 + Math.random() * 0.35, 0), std(0x6f6250));
    r.position.set((Math.random() - 0.5) * len * 0.9, h + 0.1, (Math.random() - 0.5) * thick * 0.6);
    r.castShadow = true;
    g.add(r);
  }
  return { group: g, body };
}

export function makeTentacle(color = 0x4a2a7a) {
  const g = new THREE.Group();
  const mat = std(color, { roughness: 0.5, flatShading: false, emissive: 0x1a0a30, emissiveIntensity: 0.5 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.75, 1, 12, 1), mat);
  shaft.position.y = 0.5;
  shaft.castShadow = true;
  g.add(shaft);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), mat);
  g.add(tip);
  const cupMat = std(0xc8a0ff, { roughness: 0.4, flatShading: false });
  const cups = [];
  for (let i = 0; i < 7; i++) { const c = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), cupMat); g.add(c); cups.push(c); }
  // altura h: estira el fuste y recoloca la punta y las ventosas
  const setHeight = (h) => {
    shaft.scale.set(1, Math.max(0.05, h), 1);
    shaft.position.y = h / 2;
    tip.position.y = h;
    cups.forEach((c, i) => { const t = (i + 1) / 8; c.position.set(Math.sin(i * 2.4) * (0.7 - 0.45 * t) , h * t, Math.cos(i * 2.4) * (0.7 - 0.45 * t)); });
  };
  setHeight(0.05);
  return { group: g, setHeight };
}

export function makeCloud(r = 2.6) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x59606e, roughness: 1, emissive: 0x000000, transparent: true, opacity: 0.92, flatShading: true });
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Mesh(new THREE.IcosahedronGeometry(r * (0.5 + Math.random() * 0.45), 1), mat);
    s.position.set((Math.random() - 0.5) * r * 1.8, (Math.random() - 0.3) * r * 0.5, (Math.random() - 0.5) * r * 1.8);
    g.add(s);
  }
  return { group: g, mat };
}

export function makeStatue(r = 0.9, h = 2.6) {
  const g = new THREE.Group();
  const mat = std(0x8c8f96, { roughness: 1 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r, h * 0.7, 9), mat);
  body.position.y = h * 0.35;
  const head = new THREE.Mesh(new THREE.SphereGeometry(r * 0.55, 10, 8), mat);
  head.position.y = h * 0.82;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.2, r * 1.3, 0.35, 10), std(0x6a6c72));
  base.position.y = 0.17;
  for (const m of [body, head, base]) m.castShadow = m.receiveShadow = true;
  g.add(body, head, base);
  return { group: g };
}

// Serpiente del cabello de Medusa: cuerpo curvo (3 tramos) + cabeza con ojos brillantes
export function makeSnake(color = 0x3f8f3f) {
  const g = new THREE.Group();
  const mat = std(color, { roughness: 0.5, flatShading: false });
  const segs = [];
  let parent = g;
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Group();
    s.position.y = i === 0 ? 0 : 0.5;
    parent.add(s);
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.16 - i * 0.02, 0.5, 3, 8), mat);
    m.position.y = 0.25;
    m.castShadow = true;
    s.add(m);
    segs.push(s);
    parent = s;
  }
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.42, 8), mat);
  head.position.y = 0.55;
  head.rotation.x = 0.0;
  parent.add(head);
  const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9aff6a).multiplyScalar(2.5) });
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), eyeMat); e.position.set(s * 0.1, 0.45, 0.1); parent.add(e); }
  return { group: g, segs, eyeMat };
}

// Textura espiral (brazos azules/blancos) para el remolino del Kraken
export function spiralTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  const grad = x.createRadialGradient(128, 128, 4, 128, 128, 128);
  grad.addColorStop(0, 'rgba(10,30,70,0.95)');
  grad.addColorStop(1, 'rgba(30,110,190,0.0)');
  x.fillStyle = grad;
  x.fillRect(0, 0, 256, 256);
  x.lineCap = 'round';
  for (let arm = 0; arm < 5; arm++) {
    x.strokeStyle = arm % 2 ? 'rgba(210,240,255,0.75)' : 'rgba(110,190,255,0.7)';
    x.lineWidth = 7;
    x.beginPath();
    for (let t = 0; t <= 1; t += 0.02) {
      const a = arm * (TAU / 5) + t * 6.2;
      const r = 8 + t * 116;
      const px = 128 + Math.cos(a) * r, py = 128 + Math.sin(a) * r;
      if (t === 0) x.moveTo(px, py); else x.lineTo(px, py);
    }
    x.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
