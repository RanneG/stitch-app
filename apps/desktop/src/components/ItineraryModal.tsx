import type { Message, MessageBlock, TripContext } from "@stitch/shared";

type BookingKind = "flight" | "hotel" | "restaurant";

type BookingEntry = {
  kind: BookingKind;
  provider: string;
  detail: string;
  confirmationCode?: string;
  totalCents: number;
  currency: string;
  notes: string[];
};

type ItineraryModalProps = {
  tripContext?: TripContext;
  messages: Message[];
  onClose: () => void;
};

export function ItineraryModal({
  tripContext,
  messages,
  onClose,
}: ItineraryModalProps) {
  const itinerary = deriveItinerary(messages);
  const hasBookings =
    itinerary.flights.length > 0 ||
    itinerary.hotels.length > 0 ||
    itinerary.restaurants.length > 0;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-stitch-action/30 p-4">
      <div className="w-full max-w-3xl rounded-3xl bg-stitch-card p-5 shadow-xl ring-1 ring-stitch-neutral/50">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-display text-lg font-semibold text-stitch-heading">
              Stitch itinerary
            </p>
            <p className="font-body mt-1 text-sm text-stitch-secondary">
              {tripContext
                ? `${tripContext.destinationLabel} · ${tripContext.dateRange.start} to ${tripContext.dateRange.end}`
                : "Load a demo to generate itinerary context."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-stitch-neutral/45 px-3 py-1 font-body text-xs font-semibold text-stitch-heading"
          >
            Close
          </button>
        </div>

        <div className="mt-4 max-h-[52vh] space-y-4 overflow-y-auto pr-1">
          {!hasBookings ? (
            <div className="rounded-2xl bg-stitch-neutral/20 p-4 ring-1 ring-stitch-neutral/40">
              <p className="font-body text-sm font-semibold text-stitch-heading">
                No bookings yet
              </p>
              <p className="mt-1 font-body text-sm text-stitch-secondary">
                Start by booking a flight, hotel, or restaurant to build your
                itinerary.
              </p>
            </div>
          ) : (
            <>
              <Section title="Flights" entries={itinerary.flights} emptyLabel="No flights booked yet." />
              <Section title="Hotels" entries={itinerary.hotels} emptyLabel="No hotels booked yet." />
              <Section
                title="Restaurants"
                entries={itinerary.restaurants}
                emptyLabel="No restaurants reserved yet."
              />
            </>
          )}
        </div>

        <div className="mt-4 rounded-2xl bg-stitch-neutral/20 p-4 ring-1 ring-stitch-neutral/40">
          <p className="font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-stitch-secondary">
            Total trip cost
          </p>
          <p className="mt-1 font-display text-lg font-semibold text-stitch-heading">
            USD {(itinerary.totalCents / 100).toFixed(2)}
          </p>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  entries,
  emptyLabel,
}: {
  title: string;
  entries: BookingEntry[];
  emptyLabel: string;
}) {
  return (
    <section className="rounded-2xl bg-stitch-neutral/15 p-3 ring-1 ring-stitch-neutral/35">
      <p className="font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-stitch-secondary">
        {title}
      </p>
      {entries.length === 0 ? (
        <p className="mt-2 font-body text-sm text-stitch-secondary">{emptyLabel}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {entries.map((entry, index) => (
            <li
              key={`${entry.provider}-${entry.confirmationCode ?? index}`}
              className="rounded-xl bg-stitch-card p-3 ring-1 ring-stitch-neutral/40"
            >
              <p className="font-body text-sm font-semibold text-stitch-heading">
                {entry.provider}
              </p>
              <p className="mt-1 font-body text-sm text-stitch-text">{entry.detail}</p>
              {entry.confirmationCode ? (
                <p className="mt-1 font-body text-xs text-stitch-secondary">
                  Confirmation: {entry.confirmationCode}
                </p>
              ) : null}
              <p className="mt-1 font-body text-sm font-semibold text-stitch-heading">
                {entry.currency} {(entry.totalCents / 100).toFixed(2)}
              </p>
              {entry.notes.map((note) => (
                <p key={note} className="mt-1 font-body text-xs text-stitch-secondary">
                  {note}
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function deriveItinerary(messages: Message[]) {
  const flights: BookingEntry[] = [];
  const hotels: BookingEntry[] = [];
  const restaurants: BookingEntry[] = [];
  const notesByKind: Record<BookingKind, string[]> = {
    flight: [],
    hotel: [],
    restaurant: [],
  };

  messages.forEach((message) => {
    message.content.forEach((block) => {
      if (block.type === "itinerary_delta") {
        const kind = kindFromSummary(block.summary);
        notesByKind[kind].push(block.summary);
      }

      if (block.type === "receipt_card") {
        const kind = classifyReceipt(block);
        const entry: BookingEntry = {
          kind,
          provider: block.provider,
          detail: `${block.routeLabel} · ${block.departedAtLabel}`,
          confirmationCode: block.confirmationCode,
          totalCents: block.totalCents,
          currency: block.currency,
          notes: [...notesByKind[kind]],
        };
        if (kind === "flight") flights.push(entry);
        if (kind === "hotel") hotels.push(entry);
        if (kind === "restaurant") restaurants.push(entry);
      }
    });
  });

  const totalCents = [...flights, ...hotels, ...restaurants].reduce(
    (sum, entry) => sum + entry.totalCents,
    0,
  );

  return { flights, hotels, restaurants, totalCents };
}

function kindFromSummary(summary: string): BookingKind {
  const value = summary.toLowerCase();
  if (value.includes("hotel")) return "hotel";
  if (value.includes("restaurant") || value.includes("reservation") || value.includes("dinner")) {
    return "restaurant";
  }
  return "flight";
}

function classifyReceipt(
  block: Extract<MessageBlock, { type: "receipt_card" }>,
): BookingKind {
  if (block.status === "confirmed") {
    return "restaurant";
  }
  const signal = `${block.provider} ${block.routeLabel}`.toLowerCase();
  if (signal.includes("hotel") || signal.includes("hyatt") || signal.includes("hilton")) {
    return "hotel";
  }
  if (
    signal.includes("party of") ||
    signal.includes("reservation") ||
    signal.includes("cuisine") ||
    signal.includes("buvette")
  ) {
    return "restaurant";
  }
  return "flight";
}
