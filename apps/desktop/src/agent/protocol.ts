import type { Message } from "@stitch/shared";

export const STITCH_AGENT_PROTOCOL_VERSION = "stitch.agent.v1" as const;

type AgentEventBase<TType extends string, TPayload> = {
  version: typeof STITCH_AGENT_PROTOCOL_VERSION;
  type: TType;
  sessionId: string;
  emittedAt: string;
  payload: TPayload;
};

export type AgentSessionStartedEvent = AgentEventBase<
  "agent.session.started",
  {
    source: "stub_agent";
    messageCount: number;
  }
>;

export type AgentMessageDeltaEvent = AgentEventBase<
  "agent.message.delta",
  {
    index: number;
    message: Message;
  }
>;

export type AgentSessionCompletedEvent = AgentEventBase<
  "agent.session.completed",
  {
    replayedCount: number;
  }
>;

export type AgentErrorEvent = AgentEventBase<
  "agent.error",
  {
    code: string;
    message: string;
  }
>;

export type AgentEventEnvelope =
  | AgentSessionStartedEvent
  | AgentMessageDeltaEvent
  | AgentSessionCompletedEvent
  | AgentErrorEvent;
