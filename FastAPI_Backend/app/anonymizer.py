from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass, field

from .detectors import RawDetection


SECRET_TYPES = {
    "OPENAI_API_KEY",
    "PRIVATE_KEY",
    "AWS_ACCESS_KEY",
    "GOOGLE_API_KEY",
    "GITHUB_TOKEN",
    "SLACK_TOKEN",
    "JWT",
    "BEARER_TOKEN",
    "PASSWORD_ASSIGNMENT",
    "SECRET_ASSIGNMENT",
    "JSON_SECRET",
    "HIGH_ENTROPY_SECRET",
}

VALUE_TYPES = {
    "EMAIL",
    "EMAIL_ADDRESS",
    "PHONE_IN",
    "PHONE_NUMBER",
    "PERSON",
    "ADDRESS",
    "IP_ADDRESS",
    "URL",
    "ID_VALUE",
    "CREDIT_CARD",
    "CREDIT_CARD_NUMBER",
    "US_SSN",
    "IBAN_CODE",
    "CRYPTO",
    "NRP",
}


@dataclass
class ReplacementRegistry:
    mappings: dict[tuple[str, str], str] = field(default_factory=dict)
    counters: dict[str, int] = field(default_factory=dict)

    def replacement_for(self, detection: RawDetection) -> str:
        normalized_type = _normalize_type(detection.type)
        key = (normalized_type, detection.value)
        if key not in self.mappings:
            self.mappings[key] = self._build_replacement(normalized_type, detection.value)
        return self.mappings[key]

    def _build_replacement(self, entity_type: str, value: str) -> str:
        if entity_type in SECRET_TYPES:
            return _secret_placeholder(entity_type, value)

        number = self._next_number(entity_type)

        if entity_type == "PERSON":
            return f"Person_{number:03d}"
        if entity_type == "ADDRESS":
            return f"Address_{number:03d}"
        if entity_type in {"EMAIL", "EMAIL_ADDRESS"}:
            return f"user_{number:03d}@example.test"
        if entity_type in {"PHONE_IN", "PHONE_NUMBER"}:
            return f"+91 900000{number:04d}"[-14:]
        if entity_type == "IP_ADDRESS":
            return f"10.0.0.{number}"
        if entity_type == "URL":
            return f"https://example.test/resource/{number:03d}"
        if entity_type == "ID_VALUE":
            return _id_replacement(value, number)
        if entity_type in {"CREDIT_CARD", "CREDIT_CARD_NUMBER"}:
            return f"4111 1111 1111 {number:04d}"
        if entity_type == "US_SSN":
            return f"000-00-{number:04d}"
        if entity_type == "IBAN_CODE":
            return f"GB00SAFE000000{number:06d}"
        if entity_type == "CRYPTO":
            return f"0x{'0' * 35}{number % 10}"

        return f"{entity_type.title()}_{number:03d}"

    def _next_number(self, entity_type: str) -> int:
        next_value = self.counters.get(entity_type, 0) + 1
        self.counters[entity_type] = next_value
        return next_value


def anonymize_text(text: str, detections: Iterable[RawDetection]) -> str:
    masked = text
    registry = ReplacementRegistry()
    ordered = sorted(detections, key=lambda item: item.start)
    replacements = {
        detection: registry.replacement_for(detection)
        for detection in ordered
    }

    for detection in reversed(ordered):
        masked = (
            masked[: detection.start]
            + replacements[detection]
            + masked[detection.end :]
        )

    return masked


def _normalize_type(entity_type: str) -> str:
    normalized = entity_type.upper().replace(" ", "_").replace("-", "_")
    if normalized == "EMAIL_ADDRESS":
        return "EMAIL"
    if normalized == "PHONE_NUMBER":
        return "PHONE_NUMBER"
    if normalized == "CREDIT_CARD_NUMBER":
        return "CREDIT_CARD"
    return normalized


def _secret_placeholder(entity_type: str, value: str) -> str:
    if entity_type == "BEARER_TOKEN":
        return "Bearer [TOKEN_REDACTED]" if value.lower().startswith("bearer ") else "[TOKEN_REDACTED]"
    if entity_type in {"PASSWORD_ASSIGNMENT", "JSON_SECRET"}:
        return "[PASSWORD_REDACTED]"
    if entity_type == "SECRET_ASSIGNMENT":
        return "[SECRET_REDACTED]"
    if entity_type == "HIGH_ENTROPY_SECRET":
        return "[SECRET_REDACTED]"
    return _placeholder_for(entity_type)


def _id_replacement(value: str, number: int) -> str:
    return f"ID_{number:03d}"


def _placeholder_for(entity_type: str) -> str:
    normalized = entity_type.upper().replace(" ", "_").replace("-", "_")
    return f"[{normalized}_REDACTED]"
