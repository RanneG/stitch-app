# Who can run Stitch, and what do they need?

## Short answer

| Goal | stitch-app only | linkup_mcp |
|------|-----------------|------------|
| Install deps, run **browser UI** (`npm run dev:browser`) or **Tauri** (`npm run dev`) | **Yes** — anyone with Node (and Rust for Tauri) can clone [stitch-app](https://github.com/RanneG/stitch-app) and run the app shell. | **No** — not required to *start* the dev servers. |
| **Google sign-in**, persisted **subscriptions**, **Gmail discovery**, **PDF document brain**, **face enroll/verify**, **Help / Ask Stitch** (server-backed) | **No** — the UI calls **`/api/*`** on the Vite dev server, which **proxies** to the Flask bridge. Without the bridge, those requests fail (network errors or empty data). | **Yes** — run **`stitch_rag_bridge.py`** from a [linkup_mcp](https://github.com/RanneG/linkup_mcp) clone (Python venv, `uv sync` / `pip install -e .`, Ollama for RAG/help). |
| **Bundled single window** (pywebview + built SPA + Flask on one port) | **Yes** — run `Stitch.bat` from this repo (delegates to bridge runtime in `linkup_mcp`). | **Yes** |

So: **anyone can run the Stitch frontend** from **stitch-app** alone. **Full product behavior** needs the **linkup_mcp** bridge (or a future hosted equivalent) on **`127.0.0.1:8765`** (or whatever you configure in Vite env).

## What works without the bridge

- Static layout, navigation, theme toggles, and other UI that does not depend on a successful `/api` response.
- Anything backed purely by **localStorage** / client-only state (until a feature explicitly requires the API).

## What needs the bridge

See **[BACKEND.md](BACKEND.md)** for the route list. In practice: session, subscriptions CRUD, Gmail import, RAG panel, face APIs, user guide fetch, Ask Stitch.

## Recommended dev setup (two clones)

1. Clone **linkup_mcp**, `uv sync`, run **`python stitch_rag_bridge.py`** (or `.\.venv\Scripts\python.exe stitch_rag_bridge.py` on Windows).
2. Clone **stitch-app**, `npm install`, run **`npm run dev:browser`** (or **`npm run dev`** for Tauri).
3. Ensure **Vite** proxies **`/api`** to **`http://127.0.0.1:8765`** (see `apps/desktop/vite.config.ts`).

### One-click launchers (stitch-app canonical)

- `Stitch-Desktop.bat` -> Tauri desktop + bridge
- `Stitch.bat` -> bundled single-window flow

Both launchers call `scripts/Start-Stitch.ps1` in this repo, which locates and invokes `linkup_mcp` when backend services are required.

Optional OAuth: configure `.env` in linkup_mcp per **`ENV_TEMPLATE.md`**.
