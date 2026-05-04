# HTTP backend (linkup_mcp)

Stitch’s **Google sign-in**, **subscription persistence**, **Gmail discovery**, **local PDF RAG**, **face enroll/verify**, and **Help / Ask Stitch** routes are served by the **Flask bridge** in the **[linkup_mcp](https://github.com/RanneG/linkup_mcp)** repository—not by this app alone.

## Run the bridge locally

From a clone of **linkup_mcp** (Python 3.12+, `uv sync` or `pip install -e .`):

```bash
.\.venv\Scripts\python.exe stitch_rag_bridge.py
```

Default listen address: `http://127.0.0.1:8765`

## Point Stitch at the bridge

In **apps/desktop** dev mode, Vite should proxy **`/api`** and **`/health`** to `127.0.0.1:8765`. See **`vite.config.ts`** in this repo and the integration notes in linkup_mcp under **`integrations/stitch/README.md`**.

## Environment

OAuth and optional voice/STT settings are documented in linkup_mcp’s **`ENV_TEMPLATE.md`**.
