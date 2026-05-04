import { z } from "zod";
import { tripContextSchema } from "./trip-context";

export const sessionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  createdAt: z.string().min(1),
  tripContext: tripContextSchema,
  productMode: z.enum(["travel", "subscriptions"]).optional(),
});

export type Session = z.infer<typeof sessionSchema>;

export function parseSession(input: unknown): Session {
  return sessionSchema.parse(input);
}

export function safeParseSession(input: unknown): z.SafeParseReturnType<unknown, Session> {
  return sessionSchema.safeParse(input);
}
