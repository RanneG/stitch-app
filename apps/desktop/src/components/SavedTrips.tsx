import { useEffect } from "react";

type SavedTripItem = {
  id: string;
  name: string;
  dateRangeLabel: string;
};

type SavedTripsProps = {
  open: boolean;
  trips: SavedTripItem[];
  activeTripId: string | null;
  onClose: () => void;
  onCreateTrip: () => void;
  onLoadTrip: (tripId: string) => void;
  onRenameTrip: (tripId: string) => void;
  onDeleteTrip: (tripId: string) => void;
};

export function SavedTrips({
  open,
  trips,
  activeTripId,
  onClose,
  onCreateTrip,
  onLoadTrip,
  onRenameTrip,
  onDeleteTrip,
}: SavedTripsProps) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-40 flex cursor-default items-center justify-center bg-stitch-action/30 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="saved-bookings-title"
        className="w-full max-w-xl cursor-auto rounded-3xl bg-stitch-card p-5 shadow-xl ring-1 ring-stitch-neutral/50"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <p
            id="saved-bookings-title"
            className="font-display text-lg font-semibold text-stitch-heading"
          >
            Saved Bookings
          </p>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full bg-stitch-neutral/35 px-3 py-1 font-body text-xs font-semibold text-stitch-heading"
          >
            Close
          </button>
        </div>

        <button
          type="button"
          onClick={onCreateTrip}
          className="mt-3 rounded-full bg-stitch-primary px-3 py-1.5 font-body text-xs font-semibold text-white"
        >
          + New booking
        </button>

        <ul className="mt-4 space-y-2">
          {trips.map((trip) => (
            <li key={trip.id} className="rounded-xl bg-stitch-neutral/20 p-3">
              <p className="font-body text-sm font-semibold text-stitch-heading">
                {trip.name}
                {trip.id === activeTripId ? " (current)" : ""}
              </p>
              <p className="font-body mt-0.5 text-xs text-stitch-secondary">{trip.dateRangeLabel}</p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => onLoadTrip(trip.id)}
                  className="rounded-full bg-stitch-action px-2.5 py-1 font-body text-[11px] font-semibold text-white"
                >
                  Load
                </button>
                <button
                  type="button"
                  onClick={() => onRenameTrip(trip.id)}
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
          ))}
        </ul>
      </div>
    </div>
  );
}
