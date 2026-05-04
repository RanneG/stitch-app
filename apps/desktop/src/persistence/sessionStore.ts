import { invoke } from "@tauri-apps/api/core";
import {
  messageSchema,
  sessionSchema,
  parseSession,
  type Message,
  type Session,
} from "@stitch/shared";
import { z } from "zod";

export type PersistedSession = {
  session: Session;
  messages: Message[];
};

export type SessionListItem = {
  id: string;
  title: string;
  updatedAt: string;
};

const persistedSessionSchema = z.object({
  session: z.unknown(),
  messages: z.array(z.unknown()),
});

const sessionListItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  updated_at: z.string().min(1),
});

function isTauriRuntime() {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

function assertTauriRuntime() {
  if (!isTauriRuntime()) {
    throw new Error("Tauri runtime is required for session persistence.");
  }
}

function parsePersistedSession(input: unknown): PersistedSession {
  const raw = persistedSessionSchema.parse(input);
  return {
    session: parseSession(raw.session),
    messages: raw.messages.map((item) => messageSchema.parse(item)),
  };
}

export async function saveSession(payload: PersistedSession): Promise<void> {
  assertTauriRuntime();
  const validatedPayload = {
    session: sessionSchema.parse(payload.session),
    messages: payload.messages.map((message) => messageSchema.parse(message)),
  };
  await invoke("save_session", validatedPayload);
}

export async function loadSession(sessionId: string): Promise<PersistedSession> {
  assertTauriRuntime();
  const validatedSessionId = z.string().min(1).max(128).parse(sessionId);
  const raw = await invoke("load_session", { sessionId: validatedSessionId });
  return parsePersistedSession(raw);
}

export async function listSessions(): Promise<SessionListItem[]> {
  assertTauriRuntime();
  const raw = await invoke<unknown[]>("list_sessions");
  return raw.map((item) => {
    const parsed = sessionListItemSchema.parse(item);
    return {
      id: parsed.id,
      title: parsed.title,
      updatedAt: parsed.updated_at,
    };
  });
}

export function supportsSessionPersistence() {
  return isTauriRuntime();
}
