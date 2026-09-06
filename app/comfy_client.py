from __future__ import annotations

import asyncio
import copy
import json
import random
import time
import uuid
from pathlib import Path
from typing import Any, Optional

import httpx

from app.config import COMFY_HOST

WORKFLOW_PATH = Path(__file__).resolve().parent / "workflows" / "flux_txt2img.json"
POLL_SECONDS = 600
POLL_INTERVAL = 1.0
ASPECTS = {
    "1:1": (768, 768),
    "3:4": (640, 832),
    "9:16": (576, 1024),
    "16:9": (1024, 576),
}


class ComfyError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


def _combo(info: dict[str, Any], class_name: str, key: str) -> list[str]:
    node = info.get(class_name) or {}
    inputs = node.get("input") or {}
    spec = (inputs.get("required") or {}).get(key) or (inputs.get("optional") or {}).get(key)
    if not spec:
        return []
    values = spec[0] if isinstance(spec, (list, tuple)) else spec
    if not isinstance(values, list):
        return []
    return [v for v in values if isinstance(v, str) and v]


def _match(names: list[str], *needles: str) -> Optional[str]:
    lowered = [(n, n.lower()) for n in names]
    for needle in needles:
        needle_l = needle.lower()
        for original, low in lowered:
            if needle_l in low:
                return original
    return None


def _nodes_of(workflow: dict[str, Any], class_type: str) -> list[tuple[str, dict[str, Any]]]:
    out = []
    for nid, node in workflow.items():
        if isinstance(node, dict) and node.get("class_type") == class_type:
            out.append((nid, node))
    return out


def _first_node(workflow: dict[str, Any], *class_types: str) -> tuple[str, dict[str, Any]]:
    for class_type in class_types:
        found = _nodes_of(workflow, class_type)
        if found:
            return found[0]
    raise ComfyError(f"Workflow is missing a node of type: {', '.join(class_types)}")


async def health() -> bool:
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            response = await client.get(f"{COMFY_HOST}/system_stats")
            return response.status_code == 200
    except httpx.HTTPError:
        return False


async def _object_info() -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(f"{COMFY_HOST}/object_info")
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise ComfyError(f"Cannot reach ComfyUI at {COMFY_HOST}: {exc}") from exc
    data = response.json()
    if not isinstance(data, dict):
        raise ComfyError("ComfyUI returned unexpected object_info")
    return data


async def list_models(info: Optional[dict[str, Any]] = None) -> dict[str, list[str]]:
    info = info if info is not None else await _object_info()
    checkpoints: list[str] = []
    seen = set()
    for class_name, key in (
        ("UNETLoader", "unet_name"),
        ("UnetLoaderGGUF", "unet_name"),
        ("CheckpointLoaderSimple", "ckpt_name"),
    ):
        for name in _combo(info, class_name, key):
            if name not in seen:
                seen.add(name)
                checkpoints.append(name)
    loras = _combo(info, "LoraLoader", "lora_name") or _combo(info, "LoraLoaderModelOnly", "lora_name")
    return {"checkpoints": checkpoints, "loras": loras}


def _load_template() -> dict[str, Any]:
    return json.loads(WORKFLOW_PATH.read_text(encoding="utf-8"))


def _patch_workflow(
    workflow: dict[str, Any],
    *,
    prompt: str,
    checkpoint: str,
    lora: Optional[str],
    width: int,
    height: int,
    seed: int,
    clip_l: str,
    t5: str,
    vae: str,
    info: dict[str, Any],
) -> dict[str, Any]:
    wf = copy.deepcopy(workflow)

    unet_id, unet = _first_node(wf, "UNETLoader", "UnetLoaderGGUF")
    is_gguf = checkpoint.lower().endswith(".gguf")
    if is_gguf:
        if "UnetLoaderGGUF" not in info:
            raise ComfyError(
                "Checkpoint is GGUF but ComfyUI-GGUF is not installed. "
                "Install the custom node or pick a .safetensors UNET."
            )
        unet["class_type"] = "UnetLoaderGGUF"
        unet["inputs"] = {"unet_name": checkpoint}
    else:
        unet["class_type"] = "UNETLoader"
        dtype = "default"
        if "fp8" not in checkpoint.lower():
            options = _combo(info, "UNETLoader", "weight_dtype")
            if "fp8_e4m3fn" in options:
                dtype = "fp8_e4m3fn"
        unet["inputs"] = {"unet_name": checkpoint, "weight_dtype": dtype}

    clip_id, clip_node = _first_node(wf, "DualCLIPLoader")
    clip_node["inputs"]["clip_name1"] = clip_l
    clip_node["inputs"]["clip_name2"] = t5
    clip_node["inputs"]["type"] = "flux"

    _, vae_node = _first_node(wf, "VAELoader")
    vae_node["inputs"]["vae_name"] = vae

    _, latent = _first_node(wf, "EmptySD3LatentImage")
    latent["inputs"]["width"] = width
    latent["inputs"]["height"] = height
    latent["inputs"]["batch_size"] = 1

    encodes = _nodes_of(wf, "CLIPTextEncode")
    if not encodes:
        raise ComfyError("Workflow is missing CLIPTextEncode")
    positive = encodes[0]
    for nid, node in encodes:
        text = (node.get("inputs") or {}).get("text", "")
        if text and text != "":
            positive = (nid, node)
            break
    positive[1]["inputs"]["text"] = prompt
    for nid, node in encodes:
        if nid != positive[0]:
            node["inputs"]["text"] = ""

    _, sampler = _first_node(wf, "KSampler")
    sampler["inputs"]["seed"] = seed
    sampler["inputs"]["steps"] = 20
    sampler["inputs"]["cfg"] = 1
    sampler["inputs"]["sampler_name"] = "euler"
    sampler["inputs"]["scheduler"] = "simple"

    if lora:
        if "LoraLoader" not in info:
            raise ComfyError("LoRA selected but ComfyUI has no LoraLoader node")
        lora_id = "40"
        while lora_id in wf:
            lora_id = str(int(lora_id) + 1)
        wf[lora_id] = {
            "class_type": "LoraLoader",
            "inputs": {
                "lora_name": lora,
                "strength_model": 1.0,
                "strength_clip": 1.0,
                "model": [unet_id, 0],
                "clip": [clip_id, 0],
            },
        }
        sampler["inputs"]["model"] = [lora_id, 0]
        for _, node in encodes:
            node["inputs"]["clip"] = [lora_id, 1]

    return wf


async def generate(
    prompt: str,
    checkpoint: Optional[str] = None,
    lora: Optional[str] = None,
    aspect: str = "1:1",
    seed: Optional[int] = None,
) -> bytes:
    prompt = (prompt or "").strip()
    if not prompt:
        raise ComfyError("Prompt is required", status_code=400)

    info = await _object_info()
    models = await list_models(info)
    checkpoints = models["checkpoints"]
    if not checkpoints:
        raise ComfyError(
            "No Flux UNET / checkpoint found in ComfyUI. "
            "Put flux1-dev in models/unet or models/diffusion_models.",
            status_code=400,
        )
    ckpt = (
        checkpoint
        or _match(checkpoints, "flux1-dev-fp8", "flux1-dev", "flux")
        or checkpoints[0]
    )
    if ckpt not in checkpoints:
        raise ComfyError(f"Unknown checkpoint: {ckpt}", status_code=400)

    lora_name = (lora or "").strip() or None
    if lora_name:
        if lora_name not in models["loras"]:
            raise ComfyError(f"Unknown LoRA: {lora_name}", status_code=400)

    width, height = ASPECTS.get(aspect, ASPECTS["1:1"])
    clip_names = _combo(info, "DualCLIPLoader", "clip_name1")
    clip_names2 = _combo(info, "DualCLIPLoader", "clip_name2")
    all_clips = list(dict.fromkeys(clip_names + clip_names2))
    clip_l = _match(all_clips or clip_names, "clip_l", "clip-l")
    t5 = _match(all_clips or clip_names2, "t5xxl_fp8", "t5xxl", "t5")
    vaes = _combo(info, "VAELoader", "vae_name")
    vae = _match(vaes, "ae.safetensors", "ae.s", "fluxvae", "ae")
    if not clip_l or not t5 or not vae:
        raise ComfyError(
            "ComfyUI is missing Flux CLIP or VAE files. "
            "Need clip_l, t5xxl (fp8 preferred), and ae.safetensors. See docs/COMFY.md.",
            status_code=400,
        )

    wf = _patch_workflow(
        _load_template(),
        prompt=prompt,
        checkpoint=ckpt,
        lora=lora_name,
        width=width,
        height=height,
        seed=seed if seed is not None else random.randint(0, 2**31 - 1),
        clip_l=clip_l,
        t5=t5,
        vae=vae,
        info=info,
    )

    client_id = str(uuid.uuid4())
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, read=60.0)) as client:
            queued = await client.post(
                f"{COMFY_HOST}/prompt",
                json={"prompt": wf, "client_id": client_id},
            )
            if queued.status_code >= 400:
                detail = queued.text
                try:
                    payload = queued.json()
                    detail = payload.get("error") or payload.get("node_errors") or detail
                except Exception:
                    pass
                raise ComfyError(f"ComfyUI rejected the workflow: {detail}", status_code=502)
            body = queued.json()
            node_errors = body.get("node_errors") or {}
            if node_errors:
                raise ComfyError(f"ComfyUI node errors: {node_errors}")
            prompt_id = body.get("prompt_id")
            if not prompt_id:
                raise ComfyError("ComfyUI did not return a prompt_id")

            deadline = time.monotonic() + POLL_SECONDS
            outputs = None
            while time.monotonic() < deadline:
                hist = await client.get(f"{COMFY_HOST}/history/{prompt_id}")
                hist.raise_for_status()
                data = hist.json() or {}
                entry = data.get(prompt_id)
                if entry:
                    status = entry.get("status") or {}
                    messages = status.get("messages") or []
                    for item in messages:
                        if isinstance(item, (list, tuple)) and item and item[0] == "execution_error":
                            info_err = item[1] if len(item) > 1 else item
                            raise ComfyError(f"ComfyUI execution error: {info_err}")
                    if status.get("status_str") == "error":
                        raise ComfyError("ComfyUI reported an execution error")
                    if entry.get("outputs") and (
                        status.get("completed") or status.get("status_str") == "success" or not status
                    ):
                        outputs = entry.get("outputs")
                        if outputs:
                            break
                await asyncio.sleep(POLL_INTERVAL)
            else:
                raise ComfyError("Timed out waiting for ComfyUI to finish generating")

            images = _history_images(outputs or {})
            if not images:
                raise ComfyError("ComfyUI finished without an output image")
            img = images[0]
            view = await client.get(
                f"{COMFY_HOST}/view",
                params={
                    "filename": img["filename"],
                    "subfolder": img.get("subfolder") or "",
                    "type": img.get("type") or "output",
                },
            )
            view.raise_for_status()
            return view.content
    except ComfyError:
        raise
    except httpx.HTTPError as exc:
        raise ComfyError(f"Cannot reach ComfyUI at {COMFY_HOST}: {exc}") from exc


def _history_images(outputs: dict[str, Any]) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    for node_out in outputs.values():
        if not isinstance(node_out, dict):
            continue
        for img in node_out.get("images") or []:
            if isinstance(img, dict) and img.get("filename"):
                found.append(img)
    return found
