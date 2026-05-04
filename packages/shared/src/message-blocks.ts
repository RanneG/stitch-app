import { z } from "zod";

const flightLegSchema = z.object({
  airline: z.string(),
  departTime: z.string(),
  durationLabel: z.string(),
  priceUsd: z.number().nonnegative(),
  cabin: z.string().optional(),
});

const hotelOptionSchema = z.object({
  name: z.string(),
  pricePerNightUsd: z.number().nonnegative(),
  rating: z.number().min(0).max(5).optional(),
  distanceMiles: z.number().nonnegative().optional(),
});

const restaurantOptionSchema = z.object({
  name: z.string(),
  cuisine: z.string(),
  priceRange: z.string(),
  rating: z.number().min(0).max(5).optional(),
  partySize: z.number().int().positive().optional(),
  reservationTimeLabel: z.string().optional(),
});

const confirmOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  variant: z.enum(["primary", "secondary"]).optional(),
});

const subscriptionListItemSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  amountUsd: z.number().nonnegative(),
  dueDateIso: z.string(),
  status: z.enum(["pending", "paid", "snoozed"]),
});

export const messageBlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("tool_status"),
    text: z.string(),
    phase: z.enum(["pending", "success", "error"]).optional(),
  }),
  z.object({
    type: z.literal("flight_options_row"),
    flights: z.array(flightLegSchema).min(1),
  }),
  z.object({
    type: z.literal("hotel_options_carousel"),
    hotels: z.array(hotelOptionSchema).min(1),
  }),
  z.object({
    type: z.literal("restaurant_options_row"),
    restaurants: z.array(restaurantOptionSchema).min(1),
  }),
  z.object({
    type: z.literal("payment_prompt"),
    merchant: z.string(),
    amountCents: z.number().int().nonnegative(),
    currency: z.string().length(3),
    cardLast4: z.string().length(4).optional(),
  }),
  z.object({
    type: z.literal("receipt_card"),
    provider: z.string(),
    confirmationCode: z.string(),
    routeLabel: z.string(),
    departedAtLabel: z.string(),
    totalCents: z.number().int().nonnegative(),
    currency: z.string().length(3),
    status: z.enum(["paid", "pending", "failed", "confirmed"]).optional(),
  }),
  z.object({
    type: z.literal("confirm_buttons"),
    prompt: z.string(),
    options: z.array(confirmOptionSchema).min(1),
  }),
  z.object({
    type: z.literal("itinerary_delta"),
    summary: z.string(),
    affectedDateIso: z.array(z.string()).optional(),
  }),
  z.object({
    type: z.literal("subscription_list"),
    items: z.array(subscriptionListItemSchema).min(1),
  }),
  z.object({
    type: z.literal("payment_ping"),
    subscriptionId: z.string().min(1),
    title: z.string(),
    body: z.string(),
  }),
  z.object({
    type: z.literal("voice_status"),
    listening: z.boolean(),
    text: z.string(),
  }),
]);

export type MessageBlock = z.infer<typeof messageBlockSchema>;

export function parseMessageBlock(input: unknown): MessageBlock {
  return messageBlockSchema.parse(input);
}

export function safeParseMessageBlock(
  input: unknown,
): z.SafeParseReturnType<unknown, MessageBlock> {
  return messageBlockSchema.safeParse(input);
}
