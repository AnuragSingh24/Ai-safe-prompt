from __future__ import annotations

from collections.abc import Iterable

from .detectors import RawDetection


RISK_ORDER = {"low": 0, "medium": 1, "high": 2, "critical": 3}

CRITICAL_TYPES = {
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
}

HIGH_TYPES = {
    "CREDIT_CARD",
    "CREDIT_CARD_NUMBER",
    "CRYPTO",
    "HIGH_ENTROPY_SECRET",
    "US_SSN",
    "IBAN_CODE",
}

MEDIUM_TYPES = {
    "EMAIL",
    "EMAIL_ADDRESS",
    "PHONE_IN",
    "PHONE_NUMBER",
    "PERSON",
    "ADDRESS",
    "IP_ADDRESS",
    "URL",
    "ID_VALUE",
    "NRP",
}


def risk_for_type(entity_type: str) -> str:
    normalized = entity_type.upper()
    if normalized in CRITICAL_TYPES:
        return "critical"
    if normalized in HIGH_TYPES:
        return "high"
    if normalized in MEDIUM_TYPES:
        return "medium"
    return "medium"


def classify_risk(detections: Iterable[RawDetection]) -> str:
    risk = "low"
    for detection in detections:
        detection_risk = detection.risk or risk_for_type(detection.type)
        if RISK_ORDER[detection_risk] > RISK_ORDER[risk]:
            risk = detection_risk
    return risk


def recommended_action(risk: str, detection_count: int) -> str:
    if detection_count > 0:
        return "mask"
    return "allow"
