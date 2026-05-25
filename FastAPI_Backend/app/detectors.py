from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Iterable


@dataclass(frozen=True)
class RawDetection:
    type: str
    value: str
    start: int
    end: int
    risk: str
    confidence: float


PATTERNS: tuple[tuple[str, re.Pattern[str], str, float], ...] = (
    ("PRIVATE_KEY", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"), "critical", 0.99),
    ("OPENAI_API_KEY", re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b"), "critical", 0.98),
    ("AWS_ACCESS_KEY", re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "critical", 0.98),
    ("GOOGLE_API_KEY", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b"), "critical", 0.97),
    ("GITHUB_TOKEN", re.compile(r"\bgh[pousr]_[A-Za-z0-9_]{20,}\b"), "critical", 0.97),
    ("SLACK_TOKEN", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{20,}\b"), "critical", 0.97),
    (
        "JWT",
        re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_+/=-]+\b"),
        "critical",
        0.95,
    ),
    ("BEARER_TOKEN", re.compile(r"\bBearer\s+[A-Za-z0-9\-._~+/]+=*", re.I), "critical", 0.95),
    (
        "PASSWORD_ASSIGNMENT",
        re.compile(
            r"\b([A-Za-z][A-Za-z0-9_-]*[_-](?:password|passwd|pwd)|password|passwd|pwd)"
            r"\s*[:=]\s*[\"'`]?([^,\s;}\]\"'`]+)[\"'`]?",
            re.I,
        ),
        "critical",
        0.9,
    ),
    (
        "SECRET_ASSIGNMENT",
        re.compile(
            r"\b([A-Za-z][A-Za-z0-9_-]*[_-](?:api[_-]?key|apikey|token|client[_-]?secret|secret|credential|auth)|"
            r"api[_-]?key|apikey|token|client[_-]?secret|secret|credential|auth)"
            r"\s*[:=]\s*[\"'`]?([^,\s;}\]\"'`]+)[\"'`]?",
            re.I,
        ),
        "critical",
        0.9,
    ),
    (
        "JSON_SECRET",
        re.compile(
            r"\"(password|token|api_key|apikey|client_secret|secret|credential|auth)\"\s*:\s*\"([^\"]*)\"",
            re.I,
        ),
        "critical",
        0.9,
    ),
    ("EMAIL", re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I), "medium", 0.85),
    (
        "PHONE_IN",
        re.compile(r"(?<!\d)(?:\+?91[\s-]?)?[6-9](?:[\s-]?\d){9}(?![\s-]?\d)"),
        "medium",
        0.85,
    ),
    (
        "ADDRESS",
        re.compile(
            r"\b((?:home_|shipping_|billing_)?address|street_address)\s*[:=]\s*[\"'`]?"
            r"([^\"'`\n;]{8,160})[\"'`]?",
            re.I,
        ),
        "medium",
        0.94,
    ),
    (
        "ADDRESS",
        re.compile(
            r"\b((?:lives|resides|stays|located)\s+at)\s+"
            r"((?:\d{1,6}[A-Za-z]?\s+)?(?:(?-i:[A-Z])[\w.'-]*\s+){1,6}"
            r"(?:Street|St\.?|Road|Rd\.?|Avenue|Ave\.?|Boulevard|Blvd\.?|Lane|Ln\.?|"
            r"Drive|Dr\.?|Court|Ct\.?|Circle|Cir\.?|Way|Place|Pl\.?|Terrace|Ter\.?)"
            r"\b(?:,\s*(?-i:[A-Z])[A-Za-z.'-]*(?:\s+(?-i:[A-Z])[A-Za-z.'-]*){0,2}){0,2}"
            r"(?:\s+\d{5}(?:-\d{4})?)?)",
            re.I,
        ),
        "medium",
        0.95,
    ),
    (
        "ADDRESS",
        re.compile(
            r"\b\d{1,6}[A-Za-z]?\s+(?:(?-i:[A-Z])[\w.'-]*\s+){1,6}"
            r"(?:Street|St\.?|Road|Rd\.?|Avenue|Ave\.?|Boulevard|Blvd\.?|Lane|Ln\.?|"
            r"Drive|Dr\.?|Court|Ct\.?|Circle|Cir\.?|Way|Place|Pl\.?|Terrace|Ter\.?)"
            r"\b(?:,\s*(?-i:[A-Z])[A-Za-z.'-]*(?:\s+(?-i:[A-Z])[A-Za-z.'-]*){0,2}){0,2}"
            r"(?:\s+\d{5}(?:-\d{4})?)?",
            re.I,
        ),
        "medium",
        0.9,
    ),
    ("CREDIT_CARD", re.compile(r"\b(?:\d[ -]*?){13,19}\b"), "high", 0.75),
    ("IP_ADDRESS", re.compile(r"\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b"), "medium", 0.85),
    ("URL", re.compile(r"\bhttps?://[^\s<>'\")]+", re.I), "medium", 0.8),
    (
        "ID_VALUE",
        re.compile(r"\b([a-zA-Z][a-zA-Z0-9_]*(?:_id|id)\s*[:=]\s*)[\"'`]?([A-Za-z0-9@._-]{3,})[\"'`]?", re.I),
        "medium",
        0.72,
    ),
)

HIGH_ENTROPY_RE = re.compile(r"\b[A-Za-z0-9_+=/$.-]{20,}\b")

RISK_ORDER = {"low": 0, "medium": 1, "high": 2, "critical": 3}


def scan_text(text: str) -> list[RawDetection]:
    detections: list[RawDetection] = []

    for entity_type, pattern, risk, confidence in PATTERNS:
        for match in pattern.finditer(text):
            value = _sensitive_group(match)
            start, end = _sensitive_span(match)

            if entity_type == "CREDIT_CARD" and not _looks_like_credit_card(value):
                continue

            detections.append(
                RawDetection(
                    type=entity_type,
                    value=value,
                    start=start,
                    end=end,
                    risk=risk,
                    confidence=confidence,
                )
            )

    for match in HIGH_ENTROPY_RE.finditer(text):
        value = match.group(0)
        if _is_likely_secret(value):
            detections.append(
                RawDetection(
                    type="HIGH_ENTROPY_SECRET",
                    value=value,
                    start=match.start(),
                    end=match.end(),
                    risk="high",
                    confidence=0.78,
                )
            )

    return dedupe_overlaps(detections)


def anonymize_text(text: str, detections: Iterable[RawDetection]) -> str:
    ordered = sorted(detections, key=lambda item: item.start, reverse=True)
    masked = text

    for detection in ordered:
        replacement = f"[{detection.type}_REDACTED]"
        masked = masked[: detection.start] + replacement + masked[detection.end :]

    return masked


def classify_risk(detections: Iterable[RawDetection]) -> str:
    risk = "low"
    for detection in detections:
        if RISK_ORDER[detection.risk] > RISK_ORDER[risk]:
            risk = detection.risk
    return risk


def recommended_action(risk: str, detection_count: int) -> str:
    if detection_count > 0:
        return "mask"
    return "allow"


def _sensitive_group(match: re.Match[str]) -> str:
    if match.re.pattern.startswith(r"\b([a-zA-Z][a-zA-Z0-9_]*(?:_id|id)"):
        return f"{match.group(1)}{match.group(2)}"
    if match.lastindex and match.lastindex >= 2:
        return match.group(2)
    return match.group(0)


def _sensitive_span(match: re.Match[str]) -> tuple[int, int]:
    if match.re.pattern.startswith(r"\b([a-zA-Z][a-zA-Z0-9_]*(?:_id|id)"):
        return match.start(2), match.end(2)
    if match.lastindex and match.lastindex >= 2:
        return match.start(2), match.end(2)
    return match.start(), match.end()


def dedupe_overlaps(detections: list[RawDetection]) -> list[RawDetection]:
    ordered = sorted(
        detections,
        key=lambda item: (
            -RISK_ORDER[item.risk],
            -item.confidence,
            -(item.end - item.start),
            item.start,
        ),
    )

    kept: list[RawDetection] = []
    occupied: list[range] = []

    for detection in ordered:
        current = range(detection.start, detection.end)
        if any(_ranges_overlap(current, existing) for existing in occupied):
            continue
        kept.append(detection)
        occupied.append(current)

    return sorted(kept, key=lambda item: item.start)


_dedupe_overlaps = dedupe_overlaps


def _ranges_overlap(left: range, right: range) -> bool:
    return left.start < right.stop and right.start < left.stop


def _looks_like_credit_card(value: str) -> bool:
    digits = re.sub(r"\D", "", value)
    if not 13 <= len(digits) <= 19:
        return False

    total = 0
    reverse_digits = digits[::-1]
    for index, digit in enumerate(reverse_digits):
        number = int(digit)
        if index % 2 == 1:
            number *= 2
            if number > 9:
                number -= 9
        total += number

    return total % 10 == 0


def _is_likely_secret(value: str) -> bool:
    if len(value) < 20:
        return False
    if re.match(r"^[A-Za-z0-9_]*(?:ip|url|uri|host|email|phone|id)\s*[:=]", value, re.I):
        return False
    if _looks_like_identifier(value):
        return False
    if not re.search(r"\d", value) and not re.search(r"[-_=+/$]", value):
        return False

    variety = sum(
        bool(re.search(pattern, value))
        for pattern in (r"[A-Z]", r"[a-z]", r"\d", r"[-_=+/$]")
    )
    return _entropy(value) > 3.5 and variety >= 3


def _looks_like_identifier(value: str) -> bool:
    return bool(
        re.fullmatch(r"[A-Z_]+", value)
        or re.fullmatch(r"[a-z]+_[a-z_]+", value, re.I)
        or re.fullmatch(r"[A-Za-z]+_[A-Za-z]+(?:_[A-Za-z]+)*", value)
        or re.match(r"^(dbo_|sp_|fn_|udf_|pkg_|pck\$)", value, re.I)
    )


def _entropy(value: str) -> float:
    frequencies = {char: value.count(char) for char in set(value)}
    length = len(value)
    return -sum((count / length) * math.log2(count / length) for count in frequencies.values())
