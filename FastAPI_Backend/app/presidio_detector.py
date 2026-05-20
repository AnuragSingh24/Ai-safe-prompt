from __future__ import annotations

import logging
from functools import lru_cache

from .chunking import chunk_text
from .detectors import RawDetection
from .risk import risk_for_type


logger = logging.getLogger(__name__)

PRESIDIO_ENTITIES = [
    "PERSON",
    "EMAIL_ADDRESS",
    "PHONE_NUMBER",
    "CREDIT_CARD",
    "CREDIT_CARD_NUMBER",
    "IP_ADDRESS",
    "NRP",
    "US_SSN",
    "IBAN_CODE",
    "CRYPTO",
]


@lru_cache(maxsize=1)
def _get_analyzer():
    try:
        from presidio_analyzer import AnalyzerEngine
        from presidio_analyzer.nlp_engine import NlpEngineProvider

        config = {
            "nlp_engine_name": "spacy",
            "models": [{"lang_code": "en", "model_name": "en_core_web_sm"}],
        }
        provider = NlpEngineProvider(nlp_configuration=config)
        nlp_engine = provider.create_engine()
        return AnalyzerEngine(nlp_engine=nlp_engine, supported_languages=["en"])
    except Exception as exc:
        logger.warning("Presidio/spaCy unavailable; using regex-only fallback: %s", exc)
        return None


def scan_with_presidio(text: str) -> list[RawDetection]:
    analyzer = _get_analyzer()
    if analyzer is None:
        return []

    detections: list[RawDetection] = []

    for chunk in chunk_text(text):
        try:
            results = analyzer.analyze(
                text=chunk.text,
                language="en",
                entities=PRESIDIO_ENTITIES,
                score_threshold=0.45,
            )
        except Exception as exc:
            logger.warning("Presidio scan failed for chunk %s-%s: %s", chunk.start, chunk.end, exc)
            continue

        for result in results:
            start = chunk.start + result.start
            end = chunk.start + result.end
            if start < 0 or end > len(text) or start >= end:
                continue

            entity_type = _normalize_entity_type(result.entity_type)
            detections.append(
                RawDetection(
                    type=entity_type,
                    value=text[start:end],
                    start=start,
                    end=end,
                    risk=risk_for_type(entity_type),
                    confidence=float(result.score),
                )
            )

    return detections


def presidio_available() -> bool:
    return _get_analyzer() is not None


def _normalize_entity_type(entity_type: str) -> str:
    if entity_type == "EMAIL_ADDRESS":
        return "EMAIL"
    if entity_type == "PHONE_NUMBER":
        return "PHONE_NUMBER"
    if entity_type == "CREDIT_CARD_NUMBER":
        return "CREDIT_CARD"
    return entity_type
