import { z } from "zod";

/** Inclusive trip dates as ISO `YYYY-MM-DD` (calendar-friendly, JSON-stable). */
export const dateRangeIsoSchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type DateRangeIso = z.infer<typeof dateRangeIsoSchema>;

export const tripContextSchema = z.object({
  destinationLabel: z.string().min(1),
  dateRange: dateRangeIsoSchema,
  imageUrl: z.string().url().optional(),
  tags: z.array(z.string()),
});

export type TripContext = z.infer<typeof tripContextSchema>;

export function parseTripContext(input: unknown): TripContext {
  return tripContextSchema.parse(input);
}

export function safeParseTripContext(
  input: unknown,
): z.SafeParseReturnType<unknown, TripContext> {
  return tripContextSchema.safeParse(input);
}
