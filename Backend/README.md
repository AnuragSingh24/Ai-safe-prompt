# AI Safe Prompt Node Backend

This backend handles application data and account workflows for AI Safe Prompt. It is separate from the FastAPI privacy scanner.

## Responsibilities

- Google sign-in verification
- JWT-based app sessions
- user profile lookup
- daily coin tracking
- total coin balance
- UPI storage
- payout and redeem flows
- bug report storage

## Tech stack

- Node.js
- Express
- MongoDB with Mongoose
- Google Auth Library
- JWT
- Razorpay

## Run locally

```powershell
cd Backend
npm install
npm start
```

By default the server runs on:

```text
http://localhost:5000
```

## Environment variables

Create `Backend/.env` with:

```env
PORT=5000
GOOGLE_CLIENT_ID=your_google_client_id
JWT_SECRET=your_jwt_secret
MONGODB_URI=your_mongodb_connection_string
```

## Main files

- `server.js`: Express app and API routes
- `models/User.js`: user profile and total coin state
- `models/DailyCoins.js`: per-day earned coin tracking
- `models/Payout.js`: payout and redeem records
- `models/BugReport.js`: user-submitted bug reports

## Main routes

- `POST /api/auth/google`
- `GET /api/profile`
- `POST /api/earn-coins`
- `POST /api/save-upi`
- `POST /api/bug-reports`
- `GET /api/bug-reports`
- `POST /api/redeem`
- `GET /api/redeem-history`
- `GET /api/debug/users`

## Important note

This service does not perform prompt masking. Prompt privacy scanning lives in the FastAPI backend at `FastAPI_Backend/`.

## Development note

`node_modules/` should stay local only. Install dependencies with `npm install` and do not commit the generated folder.
