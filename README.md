# Oak

System for capturing page DOM trees from a Chrome extension, visualizing them on a React UI board, and generating page-specific Script Eval autofill code through a separate AI backend.

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
                                           └──────────────────┘
                                                    │
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
| AI Backend | `ai-backend/` | Express service for OpenAI prompt assembly and generated Script Eval code |
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

```bash
OPENAI_API_KEY=sk-... npm run dev:ai-backend
```

Optional configuration:

| Env var | Default | Purpose |
|---------|---------|---------|
| `AI_PORT` | `3848` | AI backend port |
| `OPENAI_MODEL` | `gpt-4.1` | Model used to generate Script Eval code |
| `PROFILE_FILE_PATH` | `profile.md` | Candidate profile prompt source |
| `RESUME_FILE_PATH` | `Eli Taylor.docx` | Runtime-only resume attachment source |
| `RESUME_FILE_KEY` | `eli_taylor` | Runtime file key used by `attachDroppedFile` |
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
5. Click **Auto Generate Run** on the UI board to generate a page-specific Script Eval autofill script, show it in Script Eval, attach `Eli Taylor.docx` at runtime when needed, and run it through the extension

You can also click the extension icon in the toolbar to toggle the sidebar.

## How it works

1. **Content script** injects a floating action button and slide-in sidebar (shadow DOM, Monica-style)
2. **Fetch DOM** serializes the page DOM into a multi-child tree (skips script/style, limits depth)
3. **Sidebar** sends the tree to the backend via Socket.io
4. **Backend** broadcasts `dom:tree` to all connected UI board clients
5. **UI Board** renders an expandable tree diagram with connecting lines (AVL-inspired layout, multi-child)

## Configuration

Both the extension sidebar and UI board default to `http://localhost:3847` for the backend URL. Change it in either app's connection settings.

## AI Script Eval Generation

The UI board's **Auto Generate Run** button uses the same text produced by **Copy for Analyze** and sends it to the AI backend with `profile.md`. The AI backend builds a prompt that tells the model to generate only page-specific JavaScript for the actual fields in the analyzed DOM tree, to target Oak node ids where possible, and to report any unanswerable field in the script result instead of silently skipping it.

The resume is deliberately not part of the AI prompt. Oak Script Eval already supports runtime file injection, so `Eli Taylor.docx` is served by the AI backend only as an `AttachedFile` payload and is passed to the extension eval runner under the key `eli_taylor`. Generated code must upload the resume with:

```js
window.attachDroppedFile(fileInput, 'eli_taylor');
```

That separation matters: the AI sees `profile.md` and the Analyze DOM text, while the extension receives the actual resume file only at execution time.

## Development

```bash
# Watch-build extension
npm run dev:extension

# After changes, reload extension in chrome://extensions
```
