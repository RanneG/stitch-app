import { z } from "zod";
import type { MessageBlock } from "../message-blocks";

export const flightSearchResultSchema = z.object({
  tool: z.literal("flight_search"),
  query: z.object({
    destination: z.string(),
    dateRange: z.object({
      start: z.string(),
      end: z.string(),
    }),
  }),
  flights: z.array(
    z.object({
      airline: z.string(),
      departTime: z.string(),
      durationLabel: z.string(),
      priceUsd: z.number().nonnegative(),
      cabin: z.string().optional(),
    }),
  ),
});

export const hotelSearchResultSchema = z.object({
  tool: z.literal("hotel_search"),
  location: z.string(),
  hotels: z.array(
    z.object({
      name: z.string(),
      pricePerNightUsd: z.number().nonnegative(),
      rating: z.number().min(0).max(5).optional(),
      distanceMiles: z.number().nonnegative().optional(),
    }),
  ),
});

export const calendarAddResultSchema = z.object({
  tool: z.literal("calendar_add"),
  success: z.boolean(),
  title: z.string(),
  startIso: z.string(),
  endIso: z.string(),
});

export const paymentSuccessResultSchema = z.object({
  tool: z.literal("payment_success"),
  provider: z.string(),
  confirmationCode: z.string(),
  routeLabel: z.string(),
  departedAtLabel: z.string(),
  totalCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  cardLast4: z.string().length(4).optional(),
});

export const paymentPendingResultSchema = z.object({
  provider: z.string(),
  totalCents: z.number().int().nonnegative(),
  currency: z.string().length(3).default("USD"),
});

export const expenseTrackerSelectionSchema = z.object({
  selectionId: z.string(),
});

export const itineraryUpdateSchema = z.object({
  summary: z.string(),
  affectedDateIso: z.array(z.string()).optional(),
});

export const mockToolResultSchema = z.discriminatedUnion("tool", [
  flightSearchResultSchema,
  hotelSearchResultSchema,
  calendarAddResultSchema,
  paymentSuccessResultSchema,
]);

export type FlightSearchResult = z.infer<typeof flightSearchResultSchema>;
export type HotelSearchResult = z.infer<typeof hotelSearchResultSchema>;
export type CalendarAddResult = z.infer<typeof calendarAddResultSchema>;
export type PaymentSuccessResult = z.infer<typeof paymentSuccessResultSchema>;
export type PaymentPendingResult = z.infer<typeof paymentPendingResultSchema>;
export type ExpenseTrackerSelection = z.infer<typeof expenseTrackerSelectionSchema>;
export type ItineraryUpdate = z.infer<typeof itineraryUpdateSchema>;
export type MockToolResult = z.infer<typeof mockToolResultSchema>;

export function mapFlightSearchResultToBlocks(
  input: FlightSearchResult,
): MessageBlock[] {
  return [
    {
      type: "tool_status",
      text: `Found ${input.flights.length} flights to ${input.query.destination}.`,
      phase: "success",
    },
    {
      type: "flight_options_row",
      flights: input.flights,
    },
  ];
}

export function mapHotelSearchResultToBlocks(
  input: HotelSearchResult,
): MessageBlock[] {
  return [
    {
      type: "tool_status",
      text: `Found ${input.hotels.length} hotel options in ${input.location}.`,
      phase: "success",
    },
    {
      type: "hotel_options_carousel",
      hotels: input.hotels,
    },
  ];
}

export function mapCalendarAddResultToBlocks(
  input: CalendarAddResult,
): MessageBlock[] {
  if (!input.success) {
    return [
      {
        type: "tool_status",
        text: `Unable to add ${input.title} to your calendar.`,
        phase: "error",
      },
    ];
  }

  return [
    {
      type: "tool_status",
      text: `Added "${input.title}" to your calendar.`,
      phase: "success",
    },
    {
      type: "itinerary_delta",
      summary: `Calendar synced for ${input.title}.`,
      affectedDateIso: [input.startIso, input.endIso],
    },
  ];
}

export function mapPaymentSuccessResultToBlocks(
  input: PaymentSuccessResult,
): MessageBlock[] {
  return [
    {
      type: "text",
      text: "Payment confirmed. Receipt:",
    },
    {
      type: "receipt_card",
      provider: input.provider,
      confirmationCode: input.confirmationCode,
      routeLabel: input.routeLabel,
      departedAtLabel: input.departedAtLabel,
      totalCents: input.totalCents,
      currency: input.currency,
      status: "paid",
    },
    {
      type: "confirm_buttons",
      prompt: "Want to add this to your expense tracker?",
      options: [
        { id: "add_expense", label: "Yes", variant: "primary" },
        { id: "skip_expense", label: "No", variant: "secondary" },
      ],
    },
  ];
}

export function mapPaymentPendingResultToBlocks(
  input: PaymentPendingResult,
): MessageBlock[] {
  return [
    {
      type: "tool_status",
      text: `Processing payment for ${input.provider}: $${(input.totalCents / 100).toFixed(2)}`,
      phase: "pending",
    },
  ];
}

export type RestaurantReservationPendingInput = {
  provider: string;
  summaryLine: string;
  slotLabel: string;
};

export function mapRestaurantReservationPendingToBlocks(
  input: RestaurantReservationPendingInput,
): MessageBlock[] {
  return [
    {
      type: "tool_status",
      text: `Securing your table at ${input.provider} — ${input.summaryLine} · ${input.slotLabel}. No payment is taken until you dine.`,
      phase: "pending",
    },
  ];
}

export type RestaurantReservationSuccessInput = {
  provider: string;
  confirmationCode: string;
  routeLabel: string;
  reservationSlotLabel: string;
  totalCents: number;
  currency: string;
};

export function mapRestaurantReservationSuccessToBlocks(
  input: RestaurantReservationSuccessInput,
): MessageBlock[] {
  return [
    {
      type: "text",
      text: "Reservation confirmed. Your Stitch receipt:",
    },
    {
      type: "receipt_card",
      provider: input.provider,
      confirmationCode: input.confirmationCode,
      routeLabel: input.routeLabel,
      departedAtLabel: input.reservationSlotLabel,
      totalCents: input.totalCents,
      currency: input.currency,
      status: "confirmed",
    },
    {
      type: "confirm_buttons",
      prompt: "Want to add an estimated dinner cost to your expense tracker?",
      options: [
        { id: "add_expense", label: "Yes", variant: "primary" },
        { id: "skip_expense", label: "No", variant: "secondary" },
      ],
    },
  ];
}

export function mapExpenseTrackerSelectionToBlocks(
  input: ExpenseTrackerSelection,
): MessageBlock[] {
  if (input.selectionId === "add_expense") {
    return [
      {
        type: "tool_status",
        text: "Added to expense tracker.",
        phase: "success",
      },
    ];
  }
  if (input.selectionId === "skip_expense") {
    return [
      {
        type: "text",
        text: "Okay, I will leave this out of your expense tracker.",
      },
    ];
  }
  return [
    {
      type: "tool_status",
      text: `Captured response: "${input.selectionId}"`,
      phase: "success",
    },
  ];
}

export function mapItineraryUpdateToBlocks(input: ItineraryUpdate): MessageBlock[] {
  return [
    {
      type: "itinerary_delta",
      summary: input.summary,
      affectedDateIso: input.affectedDateIso,
    },
  ];
}

/**
 * Unified mapper used by StubAgent/fixtures: raw tool result JSON -> MessageBlock[].
 * Mapper boundary: UI should only consume MessageBlock and emit UI actions.
 * Keep all tool-result decoding and provider-specific transformation logic here
 * so React components remain presentation-only and easy to swap/test.
 */
export function mapMockToolResultToBlocks(input: MockToolResult): MessageBlock[] {
  switch (input.tool) {
    case "flight_search":
      return mapFlightSearchResultToBlocks(input);
    case "hotel_search":
      return mapHotelSearchResultToBlocks(input);
    case "calendar_add":
      return mapCalendarAddResultToBlocks(input);
    case "payment_success":
      return mapPaymentSuccessResultToBlocks(input);
  }
}
