import type { Message } from "@stitch/shared";
import type { ScriptedDemo } from "../fixtures/chicagoMay2024";
import {
  STITCH_AGENT_PROTOCOL_VERSION,
  type AgentEventEnvelope,
} from "./protocol";

type StubAgentOptions = {
  baseDelayMs?: number;
  jitterMs?: number;
};

export class StubAgent {
  private active = false;

  private timeoutIds: number[] = [];

  private readonly baseDelayMs: number;

  private readonly jitterMs: number;

  constructor(options: StubAgentOptions = {}) {
    this.baseDelayMs = options.baseDelayMs ?? 700;
    this.jitterMs = options.jitterMs ?? 250;
  }

  start(demo: ScriptedDemo, onEvent: (event: AgentEventEnvelope) => void) {
    this.stop();
    this.active = true;

    const sessionId = demo.session.id;
    onEvent({
      version: STITCH_AGENT_PROTOCOL_VERSION,
      type: "agent.session.started",
      sessionId,
      emittedAt: new Date().toISOString(),
      payload: {
        source: "stub_agent",
        messageCount: demo.messages.length,
      },
    });

    demo.messages.forEach((message, index) => {
      const delay = this.calculateDelay(index, message);
      const timeoutId = window.setTimeout(() => {
        if (!this.active) return;
        onEvent({
          version: STITCH_AGENT_PROTOCOL_VERSION,
          type: "agent.message.delta",
          sessionId,
          emittedAt: new Date().toISOString(),
          payload: {
            index,
            message,
          },
        });

        if (index === demo.messages.length - 1) {
          onEvent({
            version: STITCH_AGENT_PROTOCOL_VERSION,
            type: "agent.session.completed",
            sessionId,
            emittedAt: new Date().toISOString(),
            payload: {
              replayedCount: demo.messages.length,
            },
          });
        }
      }, delay);

      this.timeoutIds.push(timeoutId);
    });
  }

  stop() {
    this.active = false;
    this.timeoutIds.forEach((id) => window.clearTimeout(id));
    this.timeoutIds = [];
  }

  private calculateDelay(index: number, message: Message) {
    const jitter = Math.floor(Math.random() * this.jitterMs);
    const messageWeight = Math.max(message.content.length - 1, 0) * 120;
    return (index + 1) * this.baseDelayMs + jitter + messageWeight;
  }
}
