import * as THREE from 'three';

/* ======================================================================
   VISIÓN A TRAVÉS DEL ESCENARIO (combate de jefe)
   Lo que queda entre la cámara y el héroe, o entre la cámara y el jefe (copas de árboles, muros,
   casas…), se vuelve semitransparente con un tramado: el combate se ve siempre.
   Se inyecta en los materiales del escenario (world.mats) una sola vez; fuera del combate de jefe
   está apagado (uSeeOn = 0) y el escenario se ve exactamente igual que antes.
   ====================================================================== */
export const SEE = {
  uSeeOn: { value: 0 },
  uSeeCam: { value: new THREE.Vector3() },
  uSeeA: { value: new THREE.Vector3() },
  uSeeB: { value: new THREE.Vector3() },
  uSeeR: { value: 2.6 },
};

const FRAG_HEAD = `
uniform float uSeeOn; uniform vec3 uSeeCam; uniform vec3 uSeeA; uniform vec3 uSeeB; uniform float uSeeR;
varying vec3 vSeeW;
float seeLine(vec3 p, vec3 a) {
  vec3 d = a - uSeeCam; float L = length(d); if (L < 0.01) return 1.0; d /= L;
  float t = dot(p - uSeeCam, d);
  if (t < 0.4 || t > L - 0.9) return 1.0;
  float r = length(p - uSeeCam - d * t);
  float R = uSeeR * mix(0.55, 1.0, t / L); // embudo: más ancho cerca del objetivo
  return smoothstep(R * 0.55, R, r);
}
`;
const FRAG_BODY = `
  if (uSeeOn > 0.5) {
    float seeK = min(seeLine(vSeeW, uSeeA), seeLine(vSeeW, uSeeB));
    if (seeK < 0.999) {
      float n = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
      if (n > seeK * 0.8 + 0.2) discard;
    }
  }
`;

const patched = new WeakSet();
export function enableSeeThrough(mats) {
  for (const m of new Set(Object.values(mats || {}))) {
    if (!m || patched.has(m) || !m.isMaterial || m.isShaderMaterial) continue;
    patched.add(m);
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (shader, r) => {
      if (prev) prev.call(m, shader, r);
      Object.assign(shader.uniforms, SEE);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vSeeW;')
        .replace('#include <project_vertex>', `#include <project_vertex>
          vec4 seeP = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            seeP = instanceMatrix * seeP;
          #endif
          vSeeW = (modelMatrix * seeP).xyz;`);
      shader.fragmentShader = FRAG_HEAD + shader.fragmentShader.replace('void main() {', 'void main() {' + FRAG_BODY);
    };
    const key = m.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : () => '';
    m.customProgramCacheKey = () => key() + '|see';
    m.needsUpdate = true;
  }
}
