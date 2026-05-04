#!/usr/bin/env bash
# Free Stitch dev ports / processes when Ctrl+C does not stop Tauri+Vite.
set -euo pipefail

echo "Stopping listeners on port 1420 (Vite)…"
for pid in $(lsof -ti :1420 2>/dev/null || true); do
  if [[ -n "${pid}" ]]; then
    kill -9 "${pid}" 2>/dev/null && echo "  killed PID ${pid}" || true
  fi
done

echo "Stopping stitch-desktop debug binary (if running)…"
pkill -9 -f "target/debug/stitch-desktop" 2>/dev/null && echo "  stitch-desktop stopped" || true

echo "Done. Start the UI again with: npm run dev:browser"
exit 0
