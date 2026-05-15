import sys
from pathlib import Path
from time import perf_counter

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

if __package__ in {None, ""}:
    sys.path.append(str(Path(__file__).resolve().parents[1]))
    from app.pipeline import scan_prompt_text
    from app.schemas import Detection, LayerSummary, ScanRequest, ScanResponse
else:
    from .pipeline import scan_prompt_text
    from .schemas import Detection, LayerSummary, ScanRequest, ScanResponse


app = FastAPI(
    title="AI Safe Prompt Privacy Firewall",
    version="1.0.0",
    description="Fast privacy scanner and anonymizer for AI prompts.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/scan", response_model=ScanResponse)
def scan_prompt(payload: ScanRequest) -> ScanResponse:
    started = perf_counter()
    result = scan_prompt_text(payload.text)
    latency_ms = round((perf_counter() - started) * 1000, 3)

    return ScanResponse(
        masked_text=result.masked_text,
        risk=result.risk,
        detections=[
            Detection(
                type=item.type,
                value=item.value,
                start=item.start,
                end=item.end,
                risk=item.risk,
                confidence=item.confidence,
            )
            for item in result.detections
        ],
        detection_count=result.detection_count,
        action=result.action,
        latency_ms=latency_ms,
        layers=[
            LayerSummary(
                name=str(layer["name"]),
                detection_count=int(layer["detection_count"]),
                enabled=bool(layer["enabled"]),
            )
            for layer in result.layers
        ],
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=8010, reload=True)
