# Oak

System for capturing page DOM trees from a Chrome extension, visualizing them on a React UI board, and generating structured AI action plans from Pure/Meta trees.

## Architecture

```
┌─────────────────────┐     socket.io      ┌──────────────────┐
│  Chrome Extension   │ ◄────────────────► │  Node Backend    │
│  (floating + sidebar)│                    │  (port 3847)     │
└──────────┬──────────┘                    └────────┬─────────┘
           │ fetch DOM                             │ broadcast
           ▼                                       ▼
    Page DOM tree                          ┌──────────────────┐
                                           │  React UI Board  │
                                           │  (port 5173)     │
                                           └────────┬─────────┘
                                                    │ HTTP
                                                    ▼
                                           ┌──────────────────┐
                                           │  AI Backend      │
                                           │  (port 3848)     │
                                           └──────────────────┘
```

## Projects

| Project | Path | Description |
|---------|------|-------------|
| Backend | `backend/` | Express + Socket.io relay server |
| AI Backend | `ai-backend/` | Express service that builds job-application action plans from Pure/Meta trees |
| UI Board | `ui-board/` | React app with AVL-style DOM tree visualization |
| Extension | `extension/` | Chrome MV3 extension with Monica-like floating button + sidebar |

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Start the backend

```bash
npm run dev:backend
```

### 3. Start the UI board

```bash
npm run dev:ui-board
```

Open http://localhost:5173

### 4. Start the AI backend

Copy `.env.example` to `.env` at the repo root and set your OpenAI settings:

```bash
cp .env.example .env
# edit .env: OPENAI_API_KEY, OPENAI_MODEL, OPENAI_REASONING_EFFORT
npm run dev:ai-backend
```

`.env` is gitignored. Configuration:

| Env var | Default | Purpose |
|---------|---------|---------|
| `OPENAI_API_KEY` | _(required)_ | OpenAI API key |
| `OPENAI_MODEL` | `gpt-4.1` | Model used for AI Analyze |
| `OPENAI_REASONING_EFFORT` | _(unset)_ | `none` / `minimal` / `low` / `medium` / `high` / `xhigh`. When set, sent as `reasoning.effort` and temperature is omitted |
| `AI_PORT` | `3848` | AI backend port |
| `PROFILE_FILE_PATH` | `profile.md` | Applicant profile source for the planner prompt |
| `VITE_AI_SERVER_URL` | `http://localhost:3848` | UI board AI backend URL |

### 5. Build & load the extension

```bash
npm run build -w extension
```

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `extension/dist`

### 6. Use it

1. Visit any website
2. Click the floating **🌳** button (bottom-right) to open the Oak sidebar
3. Click **Fetch DOM** in the sidebar
4. The DOM tree appears on the UI board in real time
5. Click **AI Analyze** to generate a JSON action plan from Pure Tree + Meta Tree (+ `profile.md`)

You can also click the extension icon in the toolbar to toggle the sidebar.

## How it works

1. **Content script** injects a floating action button and slide-in sidebar (shadow DOM, Monica-style)
2. **Fetch DOM** serializes the page DOM into a multi-child tree (skips script/style, limits depth)
3. **Sidebar** sends the tree to the backend via Socket.io
4. **Backend** broadcasts `dom:tree` to all connected UI board clients
5. **UI Board** renders an expandable tree diagram with connecting lines (AVL-inspired layout, multi-child)
6. **AI Analyze** sends Pure/Meta tree text to the AI backend, which returns a structured JSON action plan (no submit clicks)

## Configuration

Both the extension sidebar and UI board default to `http://localhost:3847` for the backend URL. Change it in either app's connection settings.

Edit `profile.md` (or set `PROFILE_FILE_PATH`) with applicant details. Missing values become `{{PLACEHOLDER}}` fields in the plan.

## Development

```bash
# Watch-build extension
npm run dev:extension

# After changes, reload extension in chrome://extensions
```
