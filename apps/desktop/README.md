# Stitch Desktop App

Desktop client for the redesigned Stitch MVP.

## Current MVP scope

- Always-on subscription list with mock data.
- Due-date ping flow with in-app popup and optional desktop notifications.
- Simulated voice keyword approval ("approve").
- Simulated face verification modal before payment approval.
- Settings for voice activation, face MFA, and auto-approve thresholds.
- Payment history view with approval records and totals.

## Tech stack

- Tauri 2
- React + TypeScript
- Vite
- Tailwind CSS

## Run

From repo root:

```bash
npm run dev
```

Browser-only UI:

```bash
npm run dev:browser
```

## Validate

```bash
npm run typecheck
npm run build
```
