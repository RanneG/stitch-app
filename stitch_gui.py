"""
Single-window Stitch: built Vite UI + Flask API in one process (pywebview shell).
"""
from __future__ import annotations

import argparse
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path


def _resolve_linkup_root() -> str:
    env_root = (os.getenv("LINKUP_MCP_ROOT") or "").strip()
    candidates = [env_root] if env_root else []
    here = Path(__file__).resolve().parent
    candidates.extend(
        [
            str((here.parent / "cursor_linkup_mcp").resolve()),
            str((here.parent / "linkup_mcp").resolve()),
        ]
    )
    for c in candidates:
        if c and os.path.isfile(os.path.join(c, "rag.py")):
            return c
    raise RuntimeError("Could not locate linkup_mcp. Set LINKUP_MCP_ROOT.")


def _extend_allowed_origins() -> None:
    for origin in ("http://127.0.0.1:8765", "http://localhost:8765"):
        cur = os.environ.get("STITCH_ALLOWED_ORIGINS", "").strip()
        if origin in cur:
            continue
        os.environ["STITCH_ALLOWED_ORIGINS"] = f"{cur},{origin}".strip(",") if cur else origin


def main() -> None:
    parser = argparse.ArgumentParser(description="Stitch SPA + RAG bridge in one pywebview window.")
    parser.add_argument(
        "--dist",
        default=os.environ.get("STITCH_DESKTOP_DIST", "").strip(),
        help="Path to apps/desktop/dist (from npm run build)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("STITCH_RAG_BRIDGE_PORT", "8765")),
        help="Port for the embedded Flask server (default 8765)",
    )
    args = parser.parse_args()

    dist = os.path.abspath(args.dist)
    if not os.path.isdir(dist) or not os.path.isfile(os.path.join(dist, "index.html")):
        print("Missing Vite build. Run npm run build in stitch-app root.", file=sys.stderr)
        raise SystemExit(1)

    linkup_root = _resolve_linkup_root()
    if linkup_root not in sys.path:
        sys.path.insert(0, linkup_root)

    os.environ["STITCH_DESKTOP_DIST"] = dist
    os.environ["STITCH_RAG_BRIDGE_PORT"] = str(args.port)
    os.environ["LINKUP_MCP_ROOT"] = linkup_root
    _extend_allowed_origins()

    try:
        import webview  # type: ignore[import-not-found]
    except ImportError:
        print("Install pywebview in the Python environment used to run this script.", file=sys.stderr)
        raise SystemExit(1) from None

    from stitch_rag_bridge import app, register_stitch_spa_routes  # noqa: WPS433
    from werkzeug.serving import make_server

    app.config["STITCH_SPA_ROOT"] = dist
    register_stitch_spa_routes()

    port = args.port
    httpd = make_server("127.0.0.1", port, app, threaded=True)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()

    for _ in range(300):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=0.5)
            break
        except (urllib.error.URLError, OSError):
            time.sleep(0.05)
    else:
        print("Flask failed to become ready on port", port, file=sys.stderr)
        httpd.shutdown()
        raise SystemExit(1)

    print(f"[stitch_gui] http://127.0.0.1:{port}/  (dist={dist})", flush=True)
    try:
        webview.create_window("Stitch", f"http://127.0.0.1:{port}/", width=1280, height=840)
        webview.start()
    finally:
        httpd.shutdown()


if __name__ == "__main__":
    main()
