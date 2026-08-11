# Oak

Chrome extension + React UI board for capturing page DOM trees, generating structured AI action plans, and running fill automation.

**Backend lives in athens-backend** (`/api/oak` + Socket.io path `/oak` on port **8980**). There is no separate Oak Express server.

## Architecture

```
┌─────────────────────┐   socket.io /oak    ┌──────────────────────┐
│  Chrome Extension   │ ◄─────────────────► │  athens-backend      │
│  (FAB + sidebar)    │                     │  :8980               │
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
| Extension | `extension/` | Chrome MV3 extension with FAB + sidebar |
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
2. Click the floating Oak logo (bottom-left) to run Fetch → Analyze → Fill (requires sign-in)
3. Or **Fetch DOM** in the sidebar — the tree appears on the UI board
4. On the UI board: **AI Analyze** then **Run**

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

Socket.io: same host, path `/oak`, handshake `auth.token` = access token.

## Development

```bash
npm run dev:extension   # watch-build extension
# Reload unpacked extension in chrome://extensions after changes
```
