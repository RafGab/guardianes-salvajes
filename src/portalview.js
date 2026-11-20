import * as THREE from 'three';

/* ======================================================================
   VISTA DESPEJADA DEL PORTAL DE RESCATE (todos los mundos)
   Delante de cada portal quedaban árboles, rocas, arbustos y adornos que tapaban a los personajes que lo cruzan
   (en Glacier casi no se veía nada). Al empezar el nivel se despeja una zona en abanico DELANTE del portal (por
   donde llega el héroe y desde donde mira la cámara) y un pequeño círculo a su alrededor:
   · se retiran de esa zona solo la vegetación, las rocas y los objetos sueltos pequeños (y sus colisiones);
   · el refugio, la cúpula, la cabaña, el propio portal, los edificios, el terreno y el agua NO se tocan;
   · el resto del escenario y su ambientación se conservan (lo retirado es una franja estrecha frente al portal).
   ====================================================================== */
const FRONT = 24, BASE_HALF = 4.5, SPREAD = 0.55, AROUND = 6.5; // largo del abanico, anchura inicial, apertura, radio
const REMOVABLE_TAGS = new Set(['tree', 'rock', 'bush', 'fence', 'obstacle', 'prop', 'crystal', 'cactus', 'log', 'stump', 'serac', 'boulder', 'snowman', 'palm', 'deadtree']);
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _q = new THREE.Quaternion(), _box = new THREE.Box3();

export function clearPortalView(game) {
  const P = game.portal, w = game.world, scene = game.scene;
  if (!P || !P.root) return 0;
  P.root.updateMatrixWorld(true);
  const o = P.root.getWorldPosition(new THREE.Vector3());
  const f = new THREE.Vector3(0, 0, 1).applyQuaternion(P.root.getWorldQuaternion(new THREE.Quaternion())); f.y = 0; f.normalize();
  const inZone = (x, z, pad = 0) => {
    const rx = x - o.x, rz = z - o.z, d = rx * f.x + rz * f.z, lat = Math.abs(rx * f.z - rz * f.x);
    if (Math.hypot(rx, rz) < AROUND + pad) return true;
    return d > -1 && d < FRONT + pad && lat < BASE_HALF + d * SPREAD + pad;
  };
  // el refugio (cúpula, cabaña, portal) nunca se toca
  const protect = new Set();
  const safeG = w.sc && w.sc.safeObj && w.sc.safeObj.group;
  if (safeG) safeG.traverse((n) => protect.add(n));
  let removed = 0;
  // 1) COLISIONES de vegetación, rocas y objetos sueltos dentro de la zona
  if (w.removeSolids) removed += w.removeSolids((s) => REMOVABLE_TAGS.has(s.tag) && inZone((s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2));
  // 2) LO QUE SE VE: copias instanciadas (bosques, rocas, matorrales) y objetos sueltos pequeños
  scene.updateMatrixWorld(true);
  // solo lo que pertenece al escenario (nunca personas por rescatar, objetos recogibles, enemigos ni efectos)
  const roots = w.ownKids ? scene.children.filter((c) => w.ownKids.has(c)) : [];
  for (const r of roots) r.traverse((n) => {
    if (protect.has(n) || !n.isMesh || !n.visible || n.userData.arenaKeep) return;
    if (n.isInstancedMesh) {
      const geo = n.geometry; if (!geo.boundingSphere) geo.computeBoundingSphere();
      let hit = false;
      for (let i = 0; i < n.count; i++) {
        n.getMatrixAt(i, _m); _m.premultiply(n.matrixWorld); _m.decompose(_p, _q, _s);
        const size = geo.boundingSphere.radius * Math.max(_s.x, _s.y, _s.z);
        if (size > 7 || size < 0.05) continue; // los grandes (montañas, edificios instanciados) no
        if (!inZone(_p.x, _p.z)) continue;
        _s.setScalar(0); _m.compose(_p, _q, _s); _m.premultiply(n.matrixWorld.clone().invert());
        n.setMatrixAt(i, _m); hit = true; removed++;
      }
      if (hit) n.instanceMatrix.needsUpdate = true;
      return;
    }
    // objeto suelto: solo si es pequeño (adorno) y está en la zona; el terreno, el agua y los edificios no
    _box.setFromObject(n); _box.getSize(_s);
    const big = Math.max(_s.x, _s.y, _s.z);
    if (big > 7 || big < 0.05 || n.userData.terrain || /terrain|water|sky|ground|road/i.test(n.name || '')) return;
    _box.getCenter(_p);
    if (_p.y > o.y + 9) return; // nubes, pájaros y efectos altos
    if (inZone(_p.x, _p.z)) { n.visible = false; removed++; }
  });
  return removed;
}
