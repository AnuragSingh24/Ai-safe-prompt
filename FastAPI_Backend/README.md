# AI Safe Prompt FastAPI Backend

Privacy scanning backend for the Chrome extension. It exposes a fast `/api/scan` endpoint that detects common secrets and personal data, returns risk metadata, and gives the extension an anonymized version of the pasted prompt.

## Run locally

```powershell
cd FastAPI_Backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m spacy download en_core_web_sm
uvicorn app.main:app --host 127.0.0.1 --port 8010 --reload
```

Health check:

```powershell
curl http://127.0.0.1:8010/health
```

Scan example:

```powershell
curl -X POST http://127.0.0.1:8010/api/scan -H "Content-Type: application/json" -d "{\"text\":\"my email is user@example.com and key is sk-1234567890abcdef\"}"
```

The extension calls this service when text is pasted or typed into common AI prompt editors.

## Scanner layers

- Regex and entropy detector runs first for API keys, JWTs, passwords, tokens, emails, phone numbers, credit cards, URLs, IPs, and ID-like values.
- Presidio + spaCy `en_core_web_sm` runs after the fast detector for NER-style PII such as names and locations.
- Large prompts are scanned in 3,000 character chunks with 200 character overlap.
- Overlapping detections are deduplicated by risk and confidence.
- If Presidio or the spaCy model is unavailable, the backend logs a warning and continues with regex-only masking.
