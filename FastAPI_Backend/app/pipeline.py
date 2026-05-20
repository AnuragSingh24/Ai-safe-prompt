from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import re

from .anonymizer import anonymize_text
from .cache import CachedScan, ScanCache
from .detectors import RawDetection, dedupe_overlaps
from .normal_masker import scan_normal_masking
from .presidio_detector import scan_with_presidio
from .risk import classify_risk, recommended_action


scan_cache = ScanCache(max_items=128)
NON_MASKED_ENTITY_TYPES = {"LOCATION", "GPE"}
LOCATION_CONTEXT_RE = re.compile(
    r"(?:\b(?:from|in|at|near|to|towards)\s+|\b(?:moved|relocated|vacation|trip|travel(?:ing)?|heading)\s+to\s+)$",
    re.I,
)
CODE_CONTEXT_RE = re.compile(
    r"(?:\b(?:CREATE|ALTER|DROP|FUNCTION|PROCEDURE|RETURNS|RETURN|BEGIN|END|CASE|WHEN|THEN|ELSE|"
    r"SELECT|FROM|WHERE|JOIN|EXEC|DB_NAME|SERVERNAME)\b|@@|[.[\]()'=])",
    re.I,
)
SQL_IDENTIFIER_RE = re.compile(r"^(?:dbo\.|ufn_|usp_|sp_|fn_|tbl_|vw_)?[A-Za-z_][A-Za-z0-9_$#@]*$")
SERVER_IDENTIFIER_RE = re.compile(r"^(?=.*\d)[A-Z0-9_$#@-]{4,}$")


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
    layer_two_detections = [
        detection
        for detection in scan_with_presidio(text)
        if not _should_keep_unmasked(text, detection)
    ]
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


def _should_keep_unmasked(text: str, detection: RawDetection) -> bool:
    entity_type = detection.type.upper()
    if entity_type in NON_MASKED_ENTITY_TYPES:
        return True

    if entity_type == "PERSON" and _looks_like_code_person_false_positive(text, detection):
        return True

    if entity_type == "PERSON" and " " not in detection.value.strip():
        context_start = max(0, detection.start - 36)
        context = text[context_start : detection.start]
        return LOCATION_CONTEXT_RE.search(context) is not None

    return False


def _looks_like_code_person_false_positive(text: str, detection: RawDetection) -> bool:
    value = detection.value.strip()
    if not value:
        return False

    context_start = max(0, detection.start - 80)
    context_end = min(len(text), detection.end + 80)
    context = text[context_start:context_end]

    if CODE_CONTEXT_RE.search(context) and (
        SQL_IDENTIFIER_RE.fullmatch(value)
        or SERVER_IDENTIFIER_RE.fullmatch(value)
        or "." in value
        or "[" in value
        or "]" in value
    ):
        return True

    if value.startswith("@") or "_" in value or "$" in value or "#" in value:
        return True

    return False
