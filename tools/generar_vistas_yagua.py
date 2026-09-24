"""
Genera las vistas de referencia de Yagua (frente, espalda, lateral, 3/4 y cabeza)
a partir de tu imagen original, para convertirlas a 3D (Meshy, Tripo, Hunyuan3D...).

Uso (PowerShell):
    $env:OPENAI_API_KEY = "tu-api-key"
    python tools/generar_vistas_yagua.py ruta/a/yagua_referencia.png

Opcional: --variantes 3   (cuantas versiones generar por vista, por defecto 2)
Salida: tools/salida_yagua/<vista>_<n>.png
Coste: cada imagen se factura en tu cuenta de OpenAI.
"""
import argparse
import base64
import os
import sys

from openai import OpenAI

BASE = (
    "Same character as the reference image: Yagua, a female anthropomorphic jaglion "
    "(lion-jaguar hybrid). Golden-orange fur with black jaguar rosettes, cream muzzle and chest, "
    "large amber eyes with long eyelashes, dense flowing golden-brown lion mane, round dark-rimmed ears, "
    "copper aviator goggles on her forehead. Black tactical adventurer suit with glowing orange trim lines, "
    "black harness straps with carabiners, black gloves, chunky black hiking boots with orange soles, "
    "wristwatch on left wrist, folded black glider pack on her back, long spotted tail with a dark tuft at the tip. "
    "Stylized-realistic 3D animation film quality (big-budget CGI), detailed fur, soft studio lighting. "
    "Do NOT change the design, colors or proportions."
)
FULL = "Plain flat light-gray background, no ground shadows, entire body visible from mane to boots, orthographic camera, centered."
APOSE = "same neutral A-pose with arms slightly away from the body and hands open, legs slightly apart."

VIEWS = {
    "1_frente": f"{BASE} Full body, front view, standing in a neutral A-pose with arms slightly away from the body and legs slightly apart, looking straight at the camera. {FULL}",
    "2_espalda": f"{BASE} Full body, exact back view (180 degrees from the front), {APOSE} Show the glider pack, harness, mane from behind and full tail. {FULL}",
    "3_lateral": f"{BASE} Full body, exact left side profile view, {APOSE} Facing left. {FULL}",
    "4_tres_cuartos": f"{BASE} Full body, three-quarter front view (45 degrees), {APOSE} {FULL}",
    "5_cabeza": f"{BASE} Close-up head and shoulders, front view, neutral relaxed expression, mane, goggles and ears fully visible. Plain flat light-gray background, even soft lighting.",
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("referencia", help="imagen original de Yagua (png/jpg)")
    ap.add_argument("--variantes", type=int, default=2)
    args = ap.parse_args()

    if "OPENAI_API_KEY" not in os.environ:
        sys.exit("Define la variable de entorno OPENAI_API_KEY antes de ejecutar.")
    if not os.path.exists(args.referencia):
        sys.exit(f"No existe la imagen de referencia: {args.referencia}")

    client = OpenAI()
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "salida_yagua")
    os.makedirs(out_dir, exist_ok=True)

    for name, prompt in VIEWS.items():
        size = "1024x1024" if name == "5_cabeza" else "1024x1536"
        print(f"Generando {name} ({args.variantes} variantes)...")
        with open(args.referencia, "rb") as ref:
            result = client.images.edit(
                model="gpt-image-1",
                image=ref,
                prompt=prompt,
                size=size,
                quality="high",
                n=args.variantes,
            )
        for i, item in enumerate(result.data, 1):
            path = os.path.join(out_dir, f"{name}_{i}.png")
            with open(path, "wb") as f:
                f.write(base64.b64decode(item.b64_json))
            print("  guardada:", path)
    print("Listo. Elige la mejor variante de cada vista y súbelas a Meshy/Tripo/Hunyuan3D.")


if __name__ == "__main__":
    main()
