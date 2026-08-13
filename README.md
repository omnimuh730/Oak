# Oak

Chrome extension + React UI board for capturing page DOM trees, generating structured AI action plans, and running fill automation.

**Backend lives in athens-backend** (`/api/oak` + Socket.io path `/oak` on port **8980**). There is no separate Oak Express server.

## Architecture

```
┌─────────────────────┐   socket.io /oak    ┌──────────────────────┐
│  Chrome Extension   │ ◄─────────────────► │  athens-backend      │
│  (sidebar overlay)  │                     │  :8980               │
└──────────┬──────────┘   HTTP /api/oak/*   └──────────┬───────────┘
           │ fetch DOM                                 │ broadcast
           ▼                                           ▼
    Page DOM tree                              ┌──────────────────┐
                                               │  React UI Board  │
                                               │  (port 5173)     │
                                               └──────────────────┘
```

Auth: Athens account username + password (`POST /api/oak/auth/signin`). AI Analyze uses the signed-in profile’s LLM key + default model, and sanitized `autoBidProfile` (secrets stripped) instead of a local `profile.md`.

## Projects

| Project | Path | Description |
|---------|------|-------------|
| UI Board | `ui-board/` | React app with DOM tree visualization + AI Analyze / Run |
| Extension | `extension/` | Chrome MV3 extension with fill sidebar |
| Shared | `shared/` | Client-side plan/DOM types (not a Nest package) |

## Quick Start

### 1. Start athens-backend

From the monorepo `athens-backend/` package:

```bash
npm run start:dev
```

Ensure your Athens profile has an LLM API key and default model set in Settings. Optional Oak env knobs are documented in `athens-backend/.env.example` (`OAK_*`).

Add the UI board origin to `CORS_ORIGIN` (e.g. `http://localhost:5173`).

### 2. Install Oak clients

```bash
cd Oak
npm install
```

### 3. Start the UI board

```bash
npm run dev:ui-board
```

Open http://localhost:5173 — sign in with your Athens credentials.

Optional: `VITE_ATHENS_API_URL=http://127.0.0.1:8980`

### 4. Build & load the extension

```bash
npm run build -w extension
```

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select `extension/dist`
4. Open the Oak sidebar → sign in with the same Athens credentials
5. Confirm Athens API URL is `http://127.0.0.1:8980` (or your backend host)

### 5. Use it

1. Visit any website
2. Click the Oak toolbar icon to open the sidebar
3. Sign in — Worker pool jobs appear in a Lens-style list
4. Click a job to open its apply URL in the current tab (bound to that tab for Fill)
5. **Fill page** — Fetch → Analyze → Fill. When the AI marks a resume/CV file input, Oak uploads the Library resume recommended for that job in Job Search.
4. In the sidebar: **Pure Tree**, **Meta Tree**, **AI Analyze**, and the plan-run step list (verified / skipped)
5. **Fetch DOM** still sends a snapshot to the UI board if you want the desktop board

## API (athens-backend)

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/oak/auth/signin` | — |
| POST | `/api/oak/auth/signout` | Bearer |
| GET | `/api/oak/auth/me` | Bearer |
| GET | `/api/oak/health` | — |
| POST | `/api/oak/ai-analyze` | Bearer |
| POST | `/api/oak/match-option` | Bearer |
| GET | `/api/oak/runtime-file` | Bearer |
| GET | `/api/oak/jobs` | Bearer — Worker Pool jobs |
| POST | `/api/oak/jobs/:jobId/mark-applied` | Bearer — clear Worker pool, then mark applied |
| GET | `/api/oak/jobs/:jobId/recommended-resume` | Bearer — Library resume assigned in Job Search |

Socket.io: same host, path `/oak`, handshake `auth.token` = access token.

## Development

```bash
npm run dev:extension   # watch-build extension
# Reload unpacked extension in chrome://extensions after changes
```
