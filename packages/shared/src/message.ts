import { z } from "zod";
import { messageBlockSchema } from "./message-blocks";

export const messageRoleSchema = z.enum(["user", "assistant", "system"]);

export type MessageRole = z.infer<typeof messageRoleSchema>;

export const messageSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  role: messageRoleSchema,
  content: z.array(messageBlockSchema),
  createdAt: z.string().min(1),
});

export type Message = z.infer<typeof messageSchema>;

export function parseMessage(input: unknown): Message {
  return messageSchema.parse(input);
}

export function safeParseMessage(input: unknown): z.SafeParseReturnType<unknown, Message> {
  return messageSchema.safeParse(input);
}
