# AI Safe Prompt

AI Safe Prompt is a Chrome extension plus local backend services that sanitize prompts before they are sent to ChatGPT or other AI tools.

The project currently has three parts:

- `AI-prompt-Safe-Extension/`: Chrome extension UI and content script
- `FastAPI_Backend/`: privacy scanning backend used during paste and live typing
- `Backend/`: Node.js backend for auth, coins, payouts, and user profile flows

## How it works

When a user pastes or types into an AI prompt box:

1. The extension detects the editable prompt field.
2. Layer 1 masking runs in `content.js` inside the browser for high-risk secrets and obvious sensitive values.
3. The masked text is sent to the FastAPI backend.
4. Layer 2 detection runs with regex plus Presidio and spaCy.
5. The extension inserts the safer prompt back into the page and shows a success notification.

This keeps prompt quality usable for debugging and code review while reducing the risk of leaking secrets or personal data.




## Features

- Automatic masking on paste
- Debounced masking during typing
- Layer 1 local browser masking before backend scan
- Layer 2 backend analysis with Presidio + spaCy NER
- Risk scoring with low, medium, high, and critical levels
- Quality-preserving anonymization for PII
- Chrome popup UI with masking toggle and animated feedback
- Separate Node backend for user, wallet, and payout flows

## Project structure

```text
Ai-safe-prompt-main/
|- AI-prompt-Safe-Extension/
|  |- manifest.json
|  |- content.js
|  |- popup.js
|  |- index.html
|  `- styles.css
|- FastAPI_Backend/
|  |- app/
|  |- tests/
|  |- requirements.txt
|  `- README.md
|- Backend/
|  |- models/
|  |- server.js
|  |- package.json
|  `- README.md
|- .gitignore
`- README.md
```

## Run the extension

1. Open `chrome://extensions`
2. Enable Developer mode
3. Choose `Load unpacked`
4. Select `AI-prompt-Safe-Extension`

## If you are facing any issue in running the extension
Watch this video : https://youtu.be/KbdZrLDc7O8

The extension expects the FastAPI backend to be available on:

- `http://127.0.0.1:8010/api/scan`
- fallback: `http://127.0.0.1:8000/api/scan`

## Run the FastAPI backend

```powershell
cd FastAPI_Backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m spacy download en_core_web_sm
uvicorn app.main:app --host 127.0.0.1 --port 8010 --reload
```

Health check:

```text
http://127.0.0.1:8010/health
```

## Run the Node backend

```powershell
cd Backend
npm install
npm start
```

Default port:

```text
http://localhost:5000
```

Set these environment variables in `Backend/.env`:

- `PORT`
- `GOOGLE_CLIENT_ID`
- `JWT_SECRET`
- `MONGODB_URI`

## Detection pipeline

### Layer 1: browser masking

Runs in the extension before sending text to the backend. It prioritizes values that should never leave the browser in raw form:

- API keys
- passwords
- JWTs
- bearer tokens
- GitHub and Slack style tokens
- private keys
- obvious emails, phones, IPs, URLs, and IDs

### Layer 2: backend masking

Runs in FastAPI with:

- regex and entropy-based detectors
- Presidio analyzer
- spaCy `en_core_web_sm`
- chunked scanning for large prompts
- overlap deduplication
- semantic anonymization for prompt quality

## Testing

FastAPI tests:

```powershell
cd FastAPI_Backend
python -m unittest discover -s tests
```

Extension script syntax checks:

```powershell
node --check AI-prompt-Safe-Extension\content.js
node --check AI-prompt-Safe-Extension\popup.js
```

## Notes

- The FastAPI backend is the privacy engine used by the extension.
- The Node backend is still kept for auth, profile, coins, and payout workflows.
- `node_modules/` and Python virtual environments are ignored by `.gitignore` and should not be committed.
