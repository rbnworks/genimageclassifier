"""
Extract prompt metadata from image files.

Supported sources (in priority order):
  1. PNG tEXt / iTXt chunks  – keys: "parameters", "prompt", "workflow"
  2. JPEG EXIF               – tags: UserComment, ImageDescription
"""

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

from PIL import Image
from PIL.ExifTags import TAGS

SUPPORTED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff"}


def extract_metadata(file_path: str) -> Optional[Dict[str, Any]]:
    """
    Return ``{"prompt": str, "created_at": datetime}`` for the given file,
    or ``None`` if no usable prompt is found or the file is unsupported.
    """
    if Path(file_path).suffix.lower() not in SUPPORTED_EXTENSIONS:
        return None

    try:
        with Image.open(file_path) as img:
            prompt = _extract_prompt(img)

        if not prompt:
            return None

        mtime = os.stat(file_path).st_mtime
        return {
            "prompt": prompt.strip(),
            "created_at": datetime.fromtimestamp(mtime),
        }
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_prompt(img: Image.Image) -> Optional[str]:
    # PNG: Automatic1111 stores full params in "parameters"; ComfyUI uses "prompt"
    if img.format == "PNG" and hasattr(img, "info"):
        for key in ("parameters", "Parameters", "prompt", "Prompt", "workflow"):
            value = img.info.get(key)
            if not value:
                continue
            if key in ("prompt", "workflow"):
                try:
                    parsed = json.loads(value)
                    found = _search_comfyui_json(parsed)
                    if found:
                        return found
                except (json.JSONDecodeError, TypeError):
                    pass
            return str(value)

    # JPEG / other: EXIF
    try:
        exif = img._getexif()  # type: ignore[attr-defined]
    except (AttributeError, Exception):
        exif = None

    if exif:
        for tag_id, raw in exif.items():
            tag = TAGS.get(tag_id, "")
            if tag in ("UserComment", "ImageDescription", "XPComment", "XPSubject"):
                text = _decode_exif_bytes(raw)
                if text:
                    return text

    return None


def _decode_exif_bytes(value: Any) -> Optional[str]:
    if isinstance(value, str):
        return value or None
    if isinstance(value, bytes):
        # UserComment may have an 8-byte charset header ("ASCII\x00\x00\x00", etc.)
        if value[:8] in (b"ASCII\x00\x00\x00", b"UNICODE\x00"):
            value = value[8:]
        for enc in ("utf-16-le", "utf-8", "latin-1"):
            try:
                decoded = value.decode(enc).strip("\x00").strip()
                if decoded:
                    return decoded
            except Exception:
                continue
    return None


def _search_comfyui_json(data: Any) -> Optional[str]:
    """Recursively search ComfyUI workflow JSON for a prompt/text string."""
    if isinstance(data, dict):
        for key in ("text", "prompt", "positive"):
            if key in data and isinstance(data[key], str) and data[key].strip():
                return data[key].strip()
        for v in data.values():
            result = _search_comfyui_json(v)
            if result:
                return result
    elif isinstance(data, list):
        for item in data:
            result = _search_comfyui_json(item)
            if result:
                return result
    return None
