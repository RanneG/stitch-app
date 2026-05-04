# Stitch MVP Security Checklist

This checklist is for the current Tauri MVP and the next deployment phase.

## 1) Tauri capabilities and local surface

- [x] No unnecessary Tauri plugins enabled (for example opener/fs plugins are not used).
- [x] Persistence is handled in Rust commands with local filesystem access only under app data dir.
- [x] Capability file kept minimal (`core:default`) and scoped to the `main` window only.
- [x] CSP is enabled in `src-tauri/tauri.conf.json` (not `null`), including explicit `connect-src`, `font-src`, and `style-src` allowances required by dev UI.

## 2) IPC payload validation

- [x] Frontend validates persistence payloads before `invoke` using shared Zod schemas:
  - `sessionSchema`
  - `messageSchema`
- [x] Frontend validates `sessionId` input for `loadSession`.
- [x] Rust validates deserialized command payloads before writing files:
  - required session fields (`id`, `title`, trip context fields)
  - date format checks (`YYYY-MM-DD`) for trip range
  - required message fields and non-empty content
- [x] Frontend validates loaded JSON on read (`parseSession`, `messageSchema`) before UI consumption.

## 3) Secrets and key handling

- [x] No API keys or tokens committed in `apps/`, `packages/`, `fixtures/`, or `docs/`.
- [x] No secret values are embedded in frontend bundles.
- [ ] Add `.env.example` for future remote agent integrations (without real values).

## 4) Future VPS / remote agent requirements

When Stitch talks to a remote agent service (Goose/MCP bridge):

- [ ] Store all credentials as environment variables on the server only:
  - `TRAVELCODE_API_KEY`
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `OPENCLAW_TOKEN`
  - `STRIPE_SECRET_KEY`
- [ ] Never expose these values in frontend `VITE_*` variables.
- [ ] Enforce HTTPS (TLS) for all remote agent endpoints.
- [ ] Add request authentication for the desktop client (token/session-based).
- [ ] Add rate limiting on any public HTTP endpoint (for example IP + token buckets).
- [ ] Add structured server logs with secret redaction.

## 5) Suggested rate limiting baseline (future HTTP endpoint)

- Global burst: 30 req / 60s per client token.
- Per route:
  - `/agent/stream`: 10 req / 60s
  - `/agent/tool/*`: 20 req / 60s
- Return `429` with retry hints.

## 6) Persistence location (macOS)

Current local session storage path:

`~/Library/Application Support/com.stitch.desktop/sessions/`
