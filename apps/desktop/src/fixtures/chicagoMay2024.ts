import {
  mapMockToolResultToBlocks,
  messageSchema,
  messageBlockSchema,
  mockToolResultSchema,
  parseSession,
  type Message,
  type MessageBlock,
  type Session,
} from "@stitch/shared";
import chicagoMay2024Fixture from "../../../../fixtures/chicago-may-2024.json";
import chicagoToolResultsFixture from "../../../../fixtures/chicago-tool-results.json";

export type ScriptedDemo = {
  session: Session;
  messages: Message[];
};

const scriptedDemoSchema = {
  parse(input: unknown): ScriptedDemo {
    const raw = input as { session?: unknown; messages?: unknown };
    return {
      session: parseSession(raw.session),
      messages: Array.isArray(raw.messages)
        ? raw.messages.map((message) => messageSchema.parse(message))
        : [],
    };
  },
};

export function loadChicagoMay2024Demo(): ScriptedDemo {
  return scriptedDemoSchema.parse(chicagoMay2024Fixture);
}

type FixtureEvent =
  | { kind: "user_text"; createdAt: string; text: string }
  | { kind: "assistant_tool_result"; createdAt: string; result: unknown }
  | { kind: "assistant_blocks"; createdAt: string; blocks: unknown[] };

export function loadChicagoToolReplayDemo(): ScriptedDemo {
  const raw = chicagoToolResultsFixture as {
    session?: unknown;
    events?: FixtureEvent[];
  };
  const session = parseSession(raw.session);
  const events = Array.isArray(raw.events) ? raw.events : [];
  const messages: Message[] = events.map((event, index) => {
    const id = `mapped-msg-${index + 1}`;
    if (event.kind === "user_text") {
      return {
        id,
        sessionId: session.id,
        role: "user",
        createdAt: event.createdAt,
        content: [{ type: "text", text: event.text }],
      };
    }

    if (event.kind === "assistant_tool_result") {
      const parsedResult = mockToolResultSchema.parse(event.result);
      return {
        id,
        sessionId: session.id,
        role: "assistant",
        createdAt: event.createdAt,
        content: mapMockToolResultToBlocks(parsedResult),
      };
    }

    const blocks: MessageBlock[] = event.blocks.map((block) =>
      messageBlockSchema.parse(block),
    );
    return {
      id,
      sessionId: session.id,
      role: "assistant",
      createdAt: event.createdAt,
      content: blocks,
    };
  });

  return { session, messages };
}
