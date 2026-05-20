# AI Safe Prompt FastAPI Backend

This service is the privacy firewall used by the Chrome extension. It receives prompt text, scans it for secrets and personal data, and returns a safer version that preserves as much prompt quality as possible.

## What it does

- powers the `POST /api/scan` endpoint used by the extension
- runs multi-layer privacy detection
- combines regex, heuristic, Presidio, and spaCy analysis
- classifies risk as `low`, `medium`, `high`, or `critical`
- returns quality-preserving anonymized text
- supports large prompt scanning with chunk overlap

## API endpoints

### `GET /health`

Returns a simple health payload:

```json
{"status":"ok"}
```

### `POST /api/scan`

Request body:

```json
{
  "text": "my email is user@example.com and key is sk-1234567890abcdef"
}
```

Response includes:

- `masked_text`
- `risk`
- `detections`
- `detection_count`
- `action`
- `latency_ms`
- `layers`

## Scanner layers

### Layer 1: normal masking

Fast detector aligned with the extension behavior for:

- API keys
- passwords
- JWTs
- bearer tokens
- cloud credentials
- credit cards
- street addresses
- email addresses
- phone numbers
- IP addresses
- URLs
- ID-like values

### Layer 2: Presidio + spaCy

Entity-aware detection for:

- person names
- phone numbers
- emails
- credit cards
- other supported Presidio entities

The default NLP model is:

```text
en_core_web_sm
```

## Run locally

```powershell
cd FastAPI_Backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m spacy download en_core_web_sm
uvicorn app.main:app --host 127.0.0.1 --port 8010 --reload
```

Alternative:

```powershell
.\.venv\Scripts\python.exe app\main.py
```

## Health check

```text
http://127.0.0.1:8010/health
```

## Example scan

```powershell
curl -X POST http://127.0.0.1:8010/api/scan -H "Content-Type: application/json" -d "{\"text\":\"Alice Johnson can be reached at alice@example.com and password=MySecretPassword123\"}"
```

## Project layout

```text
FastAPI_Backend/
|- app/
|  |- main.py
|  |- pipeline.py
|  |- anonymizer.py
|  |- normal_masker.py
|  |- presidio_detector.py
|  |- detectors.py
|  |- chunking.py
|  |- risk.py
|  |- cache.py
|  `- schemas.py
|- tests/
|  `- test_privacy_pipeline.py
|- requirements.txt
`- README.md
```

## Testing

```powershell
cd FastAPI_Backend
python -m unittest discover -s tests
```

## Fallback behavior

If Presidio or the spaCy model cannot be loaded, the backend still starts and falls back to regex-based masking so the extension continues to work.
