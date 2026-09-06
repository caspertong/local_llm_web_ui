# ComfyUI (Flux) for Hearth

Hearth can generate images when [ComfyUI](https://github.com/comfyanonymous/ComfyUI) is running locally. Chat still goes through Ollama. Image mode talks only to Comfy on `COMFY_HOST` (default `http://127.0.0.1:8188`).

Do **not** put ComfyUI in this repo’s Docker Compose on a Mac. Metal needs a native ComfyUI (or Comfy Desktop) install.

## Run ComfyUI on macOS

```bash
git clone https://github.com/comfyanonymous/ComfyUI.git
cd ComfyUI
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python main.py --listen 127.0.0.1 --port 8188
```

Optional: [ComfyUI Desktop](https://www.comfy.org/download) also serves the same HTTP API on port 8188.

Confirm `http://127.0.0.1:8188` opens, then start Hearth as usual. The **Image** toggle is always in the toolbar. Image mode (checkpoint / LoRA / aspect) only engages when `/api/health` reports `"comfy": true`.

Optional: `COMFY_HOST=http://127.0.0.1:8188`.

## Flux.1-dev weights

Official **FLUX.1-dev** is a Black Forest Labs model with a **non-commercial** license. Accept the license on Hugging Face, then download it yourself. Hearth does not vendor or auto-pull weights.

Typical Comfy folders (under your ComfyUI directory):

| File | Put in |
|---|---|
| `flux1-dev` `.safetensors` or fp8 | `models/unet/` or `models/diffusion_models/` |
| GGUF UNET (optional, often easier on a Mac) | same, after installing [ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF) |
| `clip_l.safetensors` | `models/clip/` or `models/text_encoders/` |
| `t5xxl_fp8_e4m3fn.safetensors` (fp8 preferred) | `models/clip/` or `models/text_encoders/` |
| `ae.safetensors` (Flux VAE) | `models/vae/` |

On 48GB unified memory, keep **Opera / browsers closed** while generating. Use **`flux1-dev-fp8`** and **`t5xxl_fp8_e4m3fn`** (not `t5xxl_fp16`). Hearth defaults to **768-class** sizes and 20 steps. First load is slow; later images are faster.

## Community fine-tunes (LoRAs)

Community Flux variants are usually **LoRAs** on top of `flux1-dev`, not a replacement for the base UNET.

Search and download them yourself (Civitai: filter Flux + LoRA; Hugging Face: `flux lora`). Drop files in:

`ComfyUI/models/loras/`

They show up in Hearth’s LoRA dropdown. This app does not pin or recommend a specific “uncensored” LoRA.

## Troubleshooting

- **Image mode won’t turn on** — Comfy is not reachable at `COMFY_HOST`. The toggle stays in the toolbar and shows a banner.
- **No checkpoints** — UNET is not in `unet/` or `diffusion_models/`.
- **GGUF error** — install ComfyUI-GGUF or pick a `.safetensors` UNET.
- **Missing CLIP/VAE** — DualCLIP needs `clip_l` + `t5xxl`; VAE needs `ae.safetensors`.
