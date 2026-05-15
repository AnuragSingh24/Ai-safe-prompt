from typing import Literal

from pydantic import BaseModel, Field


RiskLevel = Literal["low", "medium", "high", "critical"]


class ScanRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=200_000)
    source_url: str | None = None
    mode: str = "paste"


class Detection(BaseModel):
    type: str
    value: str
    start: int
    end: int
    risk: RiskLevel
    confidence: float


class LayerSummary(BaseModel):
    name: str
    detection_count: int
    enabled: bool = True


class ScanResponse(BaseModel):
    success: bool = True
    masked_text: str
    risk: RiskLevel
    detections: list[Detection]
    detection_count: int
    action: Literal["allow", "mask", "block"]
    latency_ms: float
    layers: list[LayerSummary] = []
