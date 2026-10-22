import * as THREE from 'three';
import { getHeroModel, HEROES, ELEMENTS } from './heroes.js';
import { HERO_SCALE } from './scale.js';
import { terrainH } from './city.js';
import { TEAM } from './skills/config.js';

// FORMACIÓN DEL EQUIPO: una tarima con tres peanas donde los héroes elegidos aparecen con el CUERPO COMPLETO.
// Cada héroe se coloca con su estatura oficial (scale.js): aquí NUNCA se escala a un héroe para que la composición
// quede bien; lo que se adapta es la cámara (distancia y altura) y el espacio entre peanas.

const PAD_X = [0, -2.9, 2.9]; // peana 0 = el héroe que inicia el combate (centro); 1 a la izquierda; 2 a la derecha
const PAD_Z = [0, 0.5, 0.5];

export class Formation {
  constructor() {
    this.group = new THREE.Group();
    this.pads = [];
    const dais = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.3, 4.2), new THREE.MeshStandardMaterial({ color: 0x1a2230, metalness: 0.6, roughness: 0.4 }));
    dais.position.y = 0.15;
    dais.receiveShadow = true;
    this.group.add(dais);
    for (let i = 0; i < TEAM.size; i++) {
      const pad = new THREE.Group();
      pad.position.set(PAD_X[i], 0.3, PAD_Z[i]);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.25, 0.22, 32), new THREE.MeshStandardMaterial({ color: 0x242e40, metalness: 0.7, roughness: 0.3 }));
      base.position.y = 0.11;
      base.castShadow = base.receiveShadow = true;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.12, 0.045, 8, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x667788).multiplyScalar(1.2) }));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.23;
      pad.add(base, ring);
      this.group.add(pad);
      this.pads.push({ pad, ring, id: null, model: null });
    }
    this.light = new THREE.PointLight(0xffe0b0, 1.4, 16, 1.4);
    this.light.position.set(0, 5, 4);
    this.group.add(this.light);
    this.base = new THREE.Vector3();
    this.t = 0;
  }

  attach(scene, x, z) {
    this.scene = scene;
    this.base.set(x, terrainH(x, z), z);
    this.group.position.copy(this.base);
    scene.add(this.group);
  }
  detach() {
    for (const p of this.pads) if (p.model) { this.scene.remove(p.model.root); p.model = null; p.id = null; }
    this.scene.remove(this.group);
  }

  // ids: héroes elegidos (en orden). `fx` para el efecto de aparición de los nuevos.
  set(ids, fx) {
    this.pads.forEach((p, i) => {
      const id = ids[i] || null;
      if (id === p.id) return;
      if (p.model) { this.scene.remove(p.model.root); p.model.setVisible(false); }
      p.id = id;
      p.model = null;
      const col = id ? ELEMENTS[HEROES.find((h) => h.id === id).element].color : 0x667788;
      p.ring.material.color.set(col).multiplyScalar(id ? 2.4 : 1.2);
      if (!id) return;
      const model = getHeroModel(id);
      this.scene.add(model.root);
      model.setVisible(true);
      model.root.scale.set(1, 1, 1);
      model.root.rotation.set(0, 0, 0);
      const x = this.base.x + PAD_X[i], z = this.base.z + PAD_Z[i], y = this.base.y + 0.3 + 0.22;
      model.root.position.set(x, y, z);
      model.root.rotation.y = i === 0 ? 0 : i === 1 ? 0.35 : -0.35; // miran al frente, los laterales ligeramente hacia dentro
      p.model = model;
      if (fx) {
        for (let k = 0; k < 36; k++) fx.sparkle(x, y + 0.2 + Math.random() * 1.8, z, col, 3);
        fx.flameRing && id === 'kairo' && fx.flameRing(x, y, z, 24);
      }
    });
  }

  // Encuadre: la cámara se adapta a la estatura del héroe más alto elegido; los héroes nunca se escalan.
  update(dt, camera) {
    this.t += dt;
    let maxH = 1.0;
    for (const p of this.pads) if (p.id) maxH = Math.max(maxH, HERO_SCALE[p.id].height);
    const sway = Math.sin(this.t * 0.4) * 0.5;
    const cx = this.base.x, cy = this.base.y + 0.5, cz = this.base.z;
    camera.position.set(cx + sway, cy + 0.7 + maxH * 0.55, cz + 5.6 + maxH * 1.1);
    camera.lookAt(cx, cy + maxH * 0.55 - 0.9, cz); // el punto de mira baja un poco: los héroes quedan por encima de la interfaz
    for (const p of this.pads) {
      if (p.model) p.model.update(dt, { speed: 0, grounded: true });
      if (p.id) p.ring.rotation.z += dt * 0.6;
    }
  }
}
