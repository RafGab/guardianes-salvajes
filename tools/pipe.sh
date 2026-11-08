#!/usr/bin/env bash
# Rig + animaciones + aligerado de un personaje.
# Uso: tools/pipe.sh NOMBRE ARCHIVO.glb ESPEC.json|- RATIO [DIR_TRABAJO]   (ESPEC '-' = el GLB ya tiene esqueleto)
#   NOMBRE   nombre de salida (p. ej. lira) -> _tmp/NOMBRE_test.glb
#   RATIO    triángulos deseados / originales (p. ej. 0.06)
# Necesita en DIR_TRABAJO: node_modules con @gltf-transform/core y /extensions, y copias de tools/rig.mjs, rigspec.js, make_anims.mjs.
set -e
NAME="$1"; SRC="$2"; SPEC="$3"; RATIO="$4"; W="${5:-$(dirname "$0")}"
H="$(cd "$(dirname "$0")/.." && pwd)"
cp "$H/tools/rig.mjs" "$H/tools/rigspec.js" "$H/tools/faceFix.mjs" "$H/tools/fixface.mjs" "$W/" 2>/dev/null || true
cp "$H/tools/make_anims.mjs" "$W/make_anims2.mjs" 2>/dev/null || true
cd "$W"
if [ "$SPEC" = "-" ]; then
  node fixface.mjs "$SRC" "$W/${NAME}_rig.glb" 2>&1 | grep -v ngon   # el modelo ya trae esqueleto: solo se endurece la cara
else
  node rig.mjs "$SRC" "$SPEC" "$W/${NAME}_rig.glb" 2>&1 | grep -v ngon
fi
node make_anims2.mjs "$W/${NAME}_rig.glb" "$W/${NAME}_anim.glb" 2>&1 | grep -v ngon | tail -1
cd "$H"
mkdir -p _tmp
npx --yes @gltf-transform/cli optimize "$W/${NAME}_anim.glb" "$H/_tmp/${NAME}_test.glb" --compress meshopt --simplify true --simplify-ratio "$RATIO" --simplify-error 0.01 --texture-compress webp --texture-size 2048 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | tail -1
