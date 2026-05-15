from __future__ import annotations

from .detectors import RawDetection, scan_text


LAYER_NAME = "normal_masking"


def scan_normal_masking(text: str) -> list[RawDetection]:
    """Layer 1: fast normal masking rules from the extension code."""
    return scan_text(text)
