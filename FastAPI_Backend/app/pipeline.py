from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256

from .anonymizer import anonymize_text
from .cache import CachedScan, ScanCache
from .detectors import RawDetection, dedupe_overlaps
from .normal_masker import scan_normal_masking
from .presidio_detector import scan_with_presidio
from .risk import classify_risk, recommended_action


scan_cache = ScanCache(max_items=128)


@dataclass(frozen=True)
class ScanResult:
    masked_text: str
    risk: str
    detections: tuple[RawDetection, ...]
    detection_count: int
    action: str
    layers: tuple[dict[str, object], ...]
    cache_hit: bool = False


def scan_prompt_text(text: str) -> ScanResult:
    cache_key = sha256(text.encode("utf-8")).hexdigest()
    cached = scan_cache.get(cache_key)
    if cached is not None:
        return ScanResult(
            masked_text=cached.masked_text,
            risk=cached.risk,
            detections=tuple(cached.detections),
            detection_count=cached.detection_count,
            action=cached.action,
            layers=tuple(cached.layers),
            cache_hit=True,
        )

    layer_one_detections = scan_normal_masking(text)
    layer_two_detections = scan_with_presidio(text)
    detections = tuple(dedupe_overlaps([*layer_one_detections, *layer_two_detections]))
    risk = classify_risk(detections)
    action = recommended_action(risk, len(detections))
    masked_text = anonymize_text(text, detections)
    layers = (
        {
            "name": "layer_1_normal_masking",
            "detection_count": len(layer_one_detections),
            "enabled": True,
        },
        {
            "name": "layer_2_presidio_spacy",
            "detection_count": len(layer_two_detections),
            "enabled": True,
        },
    )

    scan_cache.set(
        cache_key,
        CachedScan(
            masked_text=masked_text,
            risk=risk,
            detections=detections,
            detection_count=len(detections),
            action=action,
            layers=layers,
        ),
    )

    return ScanResult(
        masked_text=masked_text,
        risk=risk,
        detections=detections,
        detection_count=len(detections),
        action=action,
        layers=layers,
    )
