import * as THREE from 'three';
import { terrainH } from '../terrain.js';

/* ======================================================================
   INTERACCIÓN DE LOS PODERES CON EL ESCENARIO
   · douseFires: el agua apaga los focos de incendio que toca (quedan humeantes y mojados).
   · captureProp: un objeto destructible del escenario (escombros, rocas caídas, troncos y tablones que
     bloquean el paso) deja de ser sólido y pasa a moverse con el poder (ola o remolino).
   · dropFlung: lo que suelta el poder cae con gravedad, rebota, se queda un rato en el suelo y se hunde.
   ====================================================================== */
const rnd = (a, b) => a + Math.random() * (b - a);

export function douseFires(game, x, z, r) {
  const h = game.hazards;
  return h && h.douse ? h.douse(x, z, r) : 0;
}

// objetos del escenario que puede arrastrar el agua (cerca de x,z)
export function propsNear(game, x, z, r) {
  return game.combat.props.filter((p) => !p.dead && p.mesh && Math.hypot(p.pos.x - x, p.pos.z - z) < r + p.radius);
}

// El objeto deja de bloquear (se rompe su parte sólida) y su malla queda libre para moverla
export function captureProp(game, prop) {
  if (!prop || prop.dead || !prop.mesh) return null;
  const mesh = prop.mesh;
  mesh.updateWorldMatrix(true, false);
  game.scene.attach(mesh); // conserva su posición en el mundo
  prop.mesh = null;
  prop.destroy(); // el escenario retira el sólido y la referencia (la malla ya no es suya)
  const box = new THREE.Box3().setFromObject(mesh);
  const size = Math.max(0.4, box.getSize(new THREE.Vector3()).length() * 0.5);
  return { mesh, size, s0: mesh.scale.clone(), spin: new THREE.Vector3(rnd(-3, 3), rnd(-3, 3), rnd(-3, 3)) };
}

// Suelta objetos con velocidad: caen, rebotan, quedan en el suelo unos segundos y se hunden
export function dropFlung(game, items, life = 7) {
  const fx = game.fx;
  for (const it of items) {
    if (!it.vel) it.vel = new THREE.Vector3(rnd(-2, 2), rnd(2, 4), rnd(-2, 2));
    it.t = 0; it.landed = 0;
  }
  game.combat.linger({
    life,
    update: (dt) => {
      for (const it of items) {
        const m = it.mesh;
        it.t += dt;
        const gy = terrainH(m.position.x, m.position.z) + it.size * 0.35;
        if (it.landed < 2) {
          it.vel.y -= 18 * dt;
          m.position.addScaledVector(it.vel, dt);
          m.rotation.x += it.spin.x * dt; m.rotation.y += it.spin.y * dt; m.rotation.z += it.spin.z * dt;
          if (m.position.y < gy) {
            m.position.y = gy;
            it.landed++;
            it.vel.set(it.vel.x * 0.4, Math.abs(it.vel.y) * 0.3, it.vel.z * 0.4);
            it.spin.multiplyScalar(0.3);
            for (let k = 0; k < 4; k++) fx.dustPuff(m.position.x, gy, m.position.z, 1.2);
            fx.spray(m.position.x, gy, m.position.z, 0, 2, 0, 1);
          }
        }
        if (it.t > life - 1.4) m.position.y -= dt * it.size * 0.9; // se hunde al final
      }
    },
    end: () => { for (const it of items) { if (it.mesh.parent) it.mesh.parent.remove(it.mesh); } },
  });
}

// Suelo mojado que deja el agua: mancha oscura y brillante de bordes muy suaves que se seca poco a poco
let WET_TEX = null, WET_GEO = null;
function wetTex() {
  if (WET_TEX) return WET_TEX;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(30,55,75,0.55)'); gr.addColorStop(0.55, 'rgba(40,70,95,0.4)'); gr.addColorStop(0.8, 'rgba(120,180,220,0.18)'); gr.addColorStop(1, 'rgba(40,70,95,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  WET_TEX = new THREE.CanvasTexture(c); WET_TEX.colorSpace = THREE.SRGBColorSpace;
  return WET_TEX;
}
export function wetGround(game, x, z, r, life = 8) {
  if (!WET_GEO) { WET_GEO = new THREE.CircleGeometry(1, 24); WET_GEO.rotateX(-Math.PI / 2); }
  const m = new THREE.Mesh(WET_GEO, new THREE.MeshBasicMaterial({ map: wetTex(), transparent: true, depthWrite: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.userData.own = true;
  m.position.set(x, terrainH(x, z) + 0.05, z);
  m.rotation.y = Math.random() * 6.3;
  m.scale.set(r, 1, r * (0.7 + Math.random() * 0.3));
  m.renderOrder = 3;
  return game.vfx.add(m, life, (it) => { const k = it.t / life; m.material.opacity = Math.min(1, it.t / 0.3) * (k > 0.55 ? 1 - (k - 0.55) / 0.45 : 1); });
}
