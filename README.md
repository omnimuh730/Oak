# Oak

System for capturing page DOM trees from a Chrome extension and visualizing them on a React UI board.

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
```

## Projects

| Project | Path | Description |
|---------|------|-------------|
| Backend | `backend/` | Express + Socket.io relay server |
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

### 4. Build & load the extension

```bash
npm run build -w extension
```

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `extension/dist`

### 5. Use it

1. Visit any website
2. Click the floating **🌳** button (bottom-right) to open the Oak sidebar
3. Click **Fetch DOM** in the sidebar
4. The DOM tree appears on the UI board in real time

You can also click the extension icon in the toolbar to toggle the sidebar.

## How it works

1. **Content script** injects a floating action button and slide-in sidebar (shadow DOM, Monica-style)
2. **Fetch DOM** serializes the page DOM into a multi-child tree (skips script/style, limits depth)
3. **Sidebar** sends the tree to the backend via Socket.io
4. **Backend** broadcasts `dom:tree` to all connected UI board clients
5. **UI Board** renders an expandable tree diagram with connecting lines (AVL-inspired layout, multi-child)

## Configuration

Both the extension sidebar and UI board default to `http://localhost:3847` for the backend URL. Change it in either app's connection settings.

## Development

```bash
# Watch-build extension
npm run dev:extension

# After changes, reload extension in chrome://extensions
```
