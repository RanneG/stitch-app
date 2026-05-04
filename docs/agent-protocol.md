# Stitch Agent Event Protocol (v1)

Stitch uses a versioned JSON envelope for agent output events.

- **Protocol version:** `stitch.agent.v1`
- **Chosen transport:** **Tauri events**
- **Event channel (planned):** `stitch://agent/event`

## Why Tauri events (vs invoke streaming)

- Tauri events are a natural fit for one-to-many UI updates (chat stream, right-rail updates, status badges).
- The payload stays plain JSON and transport-agnostic.
- Later Goose/MCP integration can emit the same envelopes from Rust without changing React render code.

For now, the dev-only `StubAgent` in TypeScript emits the same envelopes in-memory (callback), so UI behavior matches future event streaming.

## Envelope shape

```json
{
  "version": "stitch.agent.v1",
  "type": "agent.message.delta",
  "sessionId": "sess-chicago-may-2024",
  "emittedAt": "2024-05-01T10:42:32.000Z",
  "payload": {}
}
```

## Event types

### `agent.session.started`

```json
{
  "version": "stitch.agent.v1",
  "type": "agent.session.started",
  "sessionId": "sess-chicago-may-2024",
  "emittedAt": "2024-05-01T10:42:00.000Z",
  "payload": {
    "source": "stub_agent",
    "messageCount": 8
  }
}
```

### `agent.message.delta`

`payload.message` is a full `Message` object already validated against shared schemas.

```json
{
  "version": "stitch.agent.v1",
  "type": "agent.message.delta",
  "sessionId": "sess-chicago-may-2024",
  "emittedAt": "2024-05-01T10:42:32.000Z",
  "payload": {
    "index": 2,
    "message": {
      "id": "msg-3",
      "sessionId": "sess-chicago-may-2024",
      "role": "assistant",
      "createdAt": "2024-05-01T10:42:32.000Z",
      "content": [
        {
          "type": "flight_options_row",
          "flights": []
        }
      ]
    }
  }
}
```

### `agent.session.completed`

```json
{
  "version": "stitch.agent.v1",
  "type": "agent.session.completed",
  "sessionId": "sess-chicago-may-2024",
  "emittedAt": "2024-05-01T10:44:30.000Z",
  "payload": {
    "replayedCount": 8
  }
}
```

### `agent.error`

```json
{
  "version": "stitch.agent.v1",
  "type": "agent.error",
  "sessionId": "sess-chicago-may-2024",
  "emittedAt": "2024-05-01T10:42:10.000Z",
  "payload": {
    "code": "STUB_TIMEOUT",
    "message": "Stub agent replay aborted."
  }
}
```

## Current implementation

- Protocol types: `apps/desktop/src/agent/protocol.ts`
- Dev replay agent: `apps/desktop/src/agent/stubAgent.ts`
- UI consumer and toggle: `apps/desktop/src/components/AppShell.tsx`

No Goose/Ollama/MCP network path is wired yet; this is local structured replay only.
