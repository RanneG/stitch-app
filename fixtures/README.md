# Fixtures

Place scripted chat sessions here so the desktop app can load deterministic demos without a live agent.

Current fixture:

- `chicago-may-2024.json` — Chicago May 10-13, 2026 flow (flight search, booking confirmation, calendar prompt, hotel options, itinerary update).
- `chicago-tool-results.json` — same Chicago flow expressed as tool-result events for mapper-driven StubAgent replay.
- `mcp-travelcode-calendar-example.json` — sample TravelCode + Google Calendar provider payloads and the mapped response shape.

See the Stitch plan: `Agent mode prompts` → Prompt 4 (`demo-script-chicago`).
