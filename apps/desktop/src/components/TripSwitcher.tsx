type TripItem = {
  id: string;
  name: string;
  dateRangeLabel: string;
};

type TripSwitcherProps = {
  trips: TripItem[];
  activeTripId: string | null;
  onSwitchTrip: (tripId: string) => void;
  onCreateTrip: () => void;
  onRenameTrip: (tripId: string, name: string) => void;
  onDeleteTrip: (tripId: string) => void;
  onDismiss?: () => void;
};

export function TripSwitcher({
  trips,
  activeTripId,
  onSwitchTrip,
  onCreateTrip,
  onRenameTrip,
  onDeleteTrip,
  onDismiss,
}: TripSwitcherProps) {
  if (trips.length === 0) return null;

  return (
    <div className="w-full max-w-xs rounded-2xl bg-stitch-card/90 p-2 shadow-sm ring-1 ring-stitch-neutral/40">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="font-body min-w-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-stitch-secondary">
          Quick switch
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onCreateTrip}
            className="rounded-full bg-stitch-primary px-2.5 py-1 font-body text-[11px] font-semibold text-white"
          >
            + New booking
          </button>
          {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Hide trip switcher"
            title="Hide trip switcher"
              className="flex h-7 w-7 items-center justify-center rounded-full bg-stitch-neutral/40 font-body text-base leading-none text-stitch-heading transition hover:bg-stitch-neutral/55"
            >
              <span aria-hidden="true">×</span>
            </button>
          ) : null}
        </div>
      </div>

      <ul className="space-y-1.5">
        {trips.map((trip) => {
          const active = trip.id === activeTripId;
          return (
            <li key={trip.id} className="rounded-xl bg-stitch-neutral/20 p-2">
              <button
                type="button"
                onClick={() => onSwitchTrip(trip.id)}
                className="w-full text-left"
              >
                <p
                  className={`font-body text-sm ${
                    active ? "font-semibold text-stitch-heading" : "font-medium text-stitch-secondary"
                  }`}
                >
                  {trip.name}
                </p>
                <p className="font-body text-[11px] text-stitch-secondary/90">
                  {trip.dateRangeLabel}
                </p>
              </button>

              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const next = window.prompt("Rename booking", trip.name)?.trim();
                    if (next) onRenameTrip(trip.id, next);
                  }}
                  className="rounded-full bg-stitch-card px-2.5 py-1 font-body text-[11px] font-medium text-stitch-heading ring-1 ring-stitch-secondary/40"
                >
                  Rename
                </button>
                <button
                  type="button"
                  disabled={trips.length <= 1}
                  onClick={() => onDeleteTrip(trip.id)}
                  className="rounded-full bg-stitch-card px-2.5 py-1 font-body text-[11px] font-medium text-stitch-heading ring-1 ring-stitch-secondary/40 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Delete
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
