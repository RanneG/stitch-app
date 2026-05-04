# Stitch

**Repository:** [github.com/RanneG/stitch-app](https://github.com/RanneG/stitch-app) — production home for the Stitch desktop app (Tauri + Vite).

**HTTP backend** (Google OAuth, subscriptions, Gmail scan, local RAG, face, Help): run **[linkup_mcp](https://github.com/RanneG/linkup_mcp)** `stitch_rag_bridge.py` locally. See **[docs/BACKEND.md](docs/BACKEND.md)**.

Always-on desktop subscription manager that pings you before renewals and lets you approve payments with voice + optional face MFA.

## Why Stitch changed

Stitch pivoted from travel booking to subscription payment control for a faster, payment-centric MVP:

- Single dashboard for recurring subscriptions
- Due-soon payment pings
- Voice-triggered approval flow (`"approve"`)
- Optional face verification before approval
- Local-first desktop experience for demo speed and privacy

## Requirements

- [Rust](https://rustup.rs/) (stable) — for `npm run dev` / Tauri builds
- Node.js 20+ and npm

## Quick start

Clone this repo, then from the **repository root**:

```bash
git clone https://github.com/RanneG/stitch-app.git
cd stitch-app
npm install
```

Run desktop app (Tauri + Vite):

```bash
npm run dev
```

Run browser-only UI (no Tauri window):

```bash
npm run dev:browser
```

Browser URL: `http://localhost:1420/` (or the port Vite prints).

## Product MVP features

- `SubscriptionList`: upcoming renewals with approve actions
- `PaymentPingPopup`: due-soon ping surface
- `VoiceStatusIndicator`: keyword listening state
- `FaceAuthModal` / face verification: optional camera gate before approval
- `SettingsPanel`: voice toggle, face MFA toggle, auto-approve threshold
- `PaymentHistory`: approved renewals and totals

## Architecture

- `apps/desktop`: Tauri 2 + React + TypeScript + Vite + Tailwind app shell
- `packages/shared`: shared schemas/types/constants
- `apps/desktop/src/fixtures/subscriptions.ts`: types and defaults (live data from the bridge when signed in)

## Development notes

Use **Vite only** so Chrome, Safari, or Cursor’s simple browser can load the app.

From the repo root:

```bash
npm install
npm run dev:browser
```

Then open **http://localhost:1420/** (or use “Simple Browser” in the editor).

`dev:browser` is the same as `dev:ui` — a clearer name. Do **not** run `npm run dev` (Tauri) in another terminal at the same time: both need port **1420** and will conflict.

**Limitation:** Browser mode does not run Tauri-specific APIs (`@tauri-apps/api` `invoke`, etc.). For full desktop behavior, use `npm run dev` in its own session when you need the native window.

### Stuck terminal or “port in use”

You probably still have **Vite** or **stitch-desktop** listening on **1420**.

- From the repo root: `npm run kill:dev` (uses `scripts/kill-dev.sh`; on Windows without bash, close the process via Task Manager or `Get-NetTCPConnection -LocalPort 1420` / `Stop-Process`).
- **macOS / Linux:** `lsof -nP -iTCP:1420 -sTCP:LISTEN` then `kill` the PID.

**Important:** If your log showed `cargo run` and `Running target/debug/stitch-desktop`, you were on **`npm run dev` (Tauri)**, not browser-only. For “just show me the app in Chrome,” use **`npm run dev:browser` only** — no Rust step.

---

## Commands

- `npm install`: install workspace dependencies
- `npm run dev`: desktop mode (Tauri window + Vite)
- `npm run dev:ui` / `npm run dev:browser`: browser mode only
- `npm run build`: production frontend build
- `npm run tauri build`: desktop bundle build
- `npm run lint`: lint desktop workspace
- `npm run typecheck`: typecheck shared + desktop workspaces
- `npm run kill:dev`: kill stuck Vite/Tauri process on port 1420 (bash script)

`dev:ui` is run internally by Tauri as `beforeDevCommand`; run it manually only when you want the browser without a native window.

## Session persistence (v1 JSON)

- Tauri commands are implemented in Rust: `save_session`, `load_session`, `list_sessions`.
- React wrappers expose typed functions: `saveSession`, `loadSession`, `listSessions` in `apps/desktop/src/persistence/sessionStore.ts`.
- Loaded data is validated on the frontend with shared schemas (`parseSession`, `messageSchema`).
- Storage format is JSON (no SQLite yet, no network sync).

### Desktop file location

Sessions are saved under the OS app data directory for the Tauri app (e.g. on macOS `~/Library/Application Support/com.stitch.desktop/sessions/`). Each session is a JSON file named from the session id (sanitized).

## Brand

User-facing name is **Stitch** only (no “Conductor” in product copy).

## Security

See `docs/security-checklist.md` for MVP hardening status (capabilities, IPC validation, CSP, and future VPS requirements).
