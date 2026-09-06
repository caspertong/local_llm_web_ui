from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Union


@dataclass
class ModelCapabilities:
    name: str
    capabilities: list[str]
    thinking: bool
    vision: bool
    gpt_oss: bool
    effort_options: list[str]
    thinking_locked: bool
    context_length: int

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "capabilities": self.capabilities,
            "thinking": self.thinking,
            "vision": self.vision,
            "gpt_oss": self.gpt_oss,
            "effort_options": self.effort_options,
            "thinking_locked": self.thinking_locked,
            "context_length": self.context_length,
        }


def _is_gpt_oss(name: str, details: Optional[dict]) -> bool:
    details = details or {}
    family = str(details.get("family") or "")
    families = details.get("families") or []
    if not isinstance(families, list):
        families = [families]
    blob = " ".join([name, family, *[str(f) for f in families]]).lower()
    return "gpt-oss" in blob or "gptoss" in blob


def _context_length(model_info: Optional[dict]) -> int:
    for key, value in (model_info or {}).items():
        if str(key).endswith(".context_length") and isinstance(value, (int, float)):
            return int(value)
    return 8192


def from_show(name: str, payload: dict) -> ModelCapabilities:
    caps = list(payload.get("capabilities") or [])
    thinking = "thinking" in caps
    vision = "vision" in caps
    gpt_oss = _is_gpt_oss(name, payload.get("details"))
    if gpt_oss:
        thinking = True
        effort_options = ["low", "medium", "high"]
        thinking_locked = True
    elif thinking:
        effort_options = ["low", "medium", "high", "max"]
        thinking_locked = False
    else:
        effort_options = []
        thinking_locked = False
    return ModelCapabilities(
        name=name,
        capabilities=caps,
        thinking=thinking,
        vision=vision,
        gpt_oss=gpt_oss,
        effort_options=effort_options,
        thinking_locked=thinking_locked,
        context_length=_context_length(payload.get("model_info")),
    )


def map_think(
    caps: ModelCapabilities,
    thinking: bool,
    effort: Optional[str],
) -> Optional[Union[bool, str]]:
    """Map UI thinking/effort onto Ollama's top-level `think` field.

    Returns None when the field should be omitted.
    """
    if not caps.thinking:
        return None
    effort_norm = (effort or "").strip().lower() or None
    if caps.gpt_oss:
        if effort_norm in caps.effort_options:
            return effort_norm
        return "medium"
    if not thinking:
        return False
    if effort_norm in caps.effort_options:
        return effort_norm
    return True
