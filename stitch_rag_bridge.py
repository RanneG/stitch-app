"""
Stitch-app bridge entrypoint.

This script delegates runtime to the bridge implementation in linkup_mcp so
Stitch can be launched from this repo as the canonical app home.
"""
from __future__ import annotations

import os
import runpy
import sys
from pathlib import Path


def _resolve_linkup_root() -> Path:
    env_root = (os.getenv("LINKUP_MCP_ROOT") or "").strip()
    candidates: list[Path] = []
    if env_root:
        candidates.append(Path(env_root).expanduser().resolve())
    here = Path(__file__).resolve().parent
    candidates.extend(
        [
            (here.parent / "cursor_linkup_mcp").resolve(),
            (here.parent / "linkup_mcp").resolve(),
        ]
    )
    for cand in candidates:
        if (cand / "stitch_rag_bridge.py").is_file():
            return cand
    raise RuntimeError("Could not locate linkup_mcp bridge source. Set LINKUP_MCP_ROOT.")


def main() -> None:
    root = _resolve_linkup_root()
    os.environ["LINKUP_MCP_ROOT"] = str(root)
    # Run the canonical bridge implementation in-process to preserve behavior.
    runpy.run_path(str(root / "stitch_rag_bridge.py"), run_name="__main__")


if __name__ == "__main__":
    main()
