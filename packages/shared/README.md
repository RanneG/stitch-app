# `@stitch/shared`

Shared **TypeScript types** and **Zod schemas** for the Stitch desktop UI and (later) agent/MCP boundaries.

## What lives here

| Module | Purpose |
|--------|---------|
| `brand` | `STITCH_APP_NAME`, `STITCH_TAGLINE` |
| `trip-context` | `TripContext`, `DateRangeIso`, `tripContextSchema` |
| `session` | `Session`, `sessionSchema`, `parseSession` |
| `message` | `Message`, `MessageRole`, `messageSchema`, `parseMessage` |
| `message-blocks` | `MessageBlock` discriminated union + `messageBlockSchema`, `parseMessageBlock` |
| `mappers/tool-results` | Mock tool-result JSON -> `MessageBlock[]` mapping helpers |

## Extension point for MCP mappers

Tool responses from MCP servers should **not** be parsed inside React components. Instead:

1. Add a **pure mapper** (e.g. `packages/shared/src/mappers/flight-search.ts`) that accepts `unknown` (or a provider-specific Zod schema), validates or narrows the shape, and returns **`MessageBlock[]`** (or a full `Message` for assistant turns).
2. Re-export mappers from `packages/shared` or a future `packages/shared/mappers` entry so `apps/desktop` only renders **`MessageBlock`** via the **message renderer registry**.
3. Keep **one discriminated union** (`MessageBlock["type"]`) as the contract between agent pipeline and UI. New card types = new union members + Zod branch + renderer stub.

The desktop registry maps `block.type` → React; it should stay a thin view layer over these types.

### Current mapper examples

- `mapFlightSearchResultToBlocks(...)`
- `mapHotelSearchResultToBlocks(...)`
- `mapCalendarAddResultToBlocks(...)`
- `mapPaymentSuccessResultToBlocks(...)`

The mock provider shape lives in `mockToolResultSchema`. For real MCP integrations, map provider payloads to that schema first (or add provider-specific schemas and map directly to `MessageBlock[]`).
