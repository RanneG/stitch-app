import { useMemo, useState } from "react";
import type { DateRangeIso, Message, Session } from "@stitch/shared";
import {
  loadChicagoMay2024Demo,
  type ScriptedDemo,
} from "../fixtures/chicagoMay2024";
import {
  listSessions,
  loadSession,
  saveSession,
  supportsSessionPersistence,
} from "../persistence/sessionStore";

const STITCH_TRIPS_STORAGE_KEY = "stitch.trips.v1";

type TripMeta = {
  bookingsCount: number;
  receiptCount: number;
  contextTags: string[];
};

export type TripRecord = {
  id: string;
  name: string;
  destination: string;
  dateRange: DateRangeIso;
  session: Session;
  messages: Message[];
  meta: TripMeta;
  updatedAt: string;
};

type StoredTripsState = {
  activeTripId: string | null;
  trips: TripRecord[];
};

export function useTrips() {
  const persistenceAvailable = supportsSessionPersistence();
  const [state, setState] = useState<StoredTripsState>(() => loadTripsState());
  const activeTrip = useMemo(
    () => state.trips.find((trip) => trip.id === state.activeTripId) ?? null,
    [state.activeTripId, state.trips],
  );

  async function saveCurrentSession(
    demo: ScriptedDemo | null,
    messages: Message[],
  ): Promise<string> {
    if (!demo || !persistenceAvailable) return "";
    await saveSession({
      session: demo.session,
      messages,
    });
    return `Saved "${demo.session.title}" to local app data.`;
  }

  async function reloadSavedSession(
    currentSessionId?: string,
  ): Promise<{ loaded: ScriptedDemo | null; status: string }> {
    if (!persistenceAvailable) {
      return { loaded: null, status: "" };
    }

    const sessions = await listSessions();
    if (sessions.length === 0) {
      return {
        loaded: null,
        status: "No saved sessions found yet. Save the demo first.",
      };
    }

    const targetSessionId = currentSessionId ?? sessions[0].id;
    const loaded = await loadSession(targetSessionId);
    return {
      loaded,
      status: `Reloaded "${loaded.session.title}" from disk.`,
    };
  }

  function createTrip() {
    const now = new Date().toISOString();
    const id = `trip-${Math.random().toString(36).slice(2, 8)}`;
    const trip: TripRecord = {
      id,
      name: "New trip",
      destination: "Set destination",
      dateRange: { start: "2026-01-01", end: "2026-01-03" },
      session: {
        id: `sess-${id}`,
        title: "New trip",
        createdAt: now,
        tripContext: {
          destinationLabel: "Set destination",
          dateRange: { start: "2026-01-01", end: "2026-01-03" },
          tags: [],
        },
      },
      messages: [],
      meta: { bookingsCount: 0, receiptCount: 0, contextTags: [] },
      updatedAt: now,
    };
    setState((prev) => {
      const next = { activeTripId: trip.id, trips: [trip, ...prev.trips] };
      persistTripsState(next);
      return next;
    });
    return trip;
  }

  function switchTrip(tripId: string): TripRecord | null {
    const selected = state.trips.find((trip) => trip.id === tripId) ?? null;
    if (!selected) return null;
    setState((prev) => {
      const next = { ...prev, activeTripId: tripId };
      persistTripsState(next);
      return next;
    });
    return selected;
  }

  function renameTrip(tripId: string, name: string) {
    setState((prev) => {
      const trips = prev.trips.map((trip) => {
        if (trip.id !== tripId) return trip;
        return {
          ...trip,
          name,
          session: { ...trip.session, title: name },
          updatedAt: new Date().toISOString(),
        };
      });
      const next = { ...prev, trips };
      persistTripsState(next);
      return next;
    });
  }

  function deleteTrip(tripId: string) {
    setState((prev) => {
      const trips = prev.trips.filter((trip) => trip.id !== tripId);
      const activeTripId = trips.some((trip) => trip.id === prev.activeTripId)
        ? prev.activeTripId
        : trips[0]?.id ?? null;
      const next = { activeTripId, trips };
      persistTripsState(next);
      return next;
    });
  }

  function upsertTripFromSession(
    demo: ScriptedDemo,
    messages: Message[],
    options?: { setActive?: boolean },
  ) {
    setState((prev) => {
      const sessionId = demo.session.id;
      const existingIndex = prev.trips.findIndex((trip) => trip.session.id === sessionId);
      const meta = buildTripMeta(demo, messages);
      const record: TripRecord = {
        id: existingIndex >= 0 ? prev.trips[existingIndex].id : `trip-${sessionId}`,
        name: demo.session.title,
        destination: demo.session.tripContext.destinationLabel,
        dateRange: demo.session.tripContext.dateRange,
        session: demo.session,
        messages,
        meta,
        updatedAt: new Date().toISOString(),
      };

      let trips = prev.trips;
      if (existingIndex >= 0) {
        const existing = prev.trips[existingIndex];
        const unchanged =
          existing.messages.length === record.messages.length &&
          existing.destination === record.destination &&
          existing.dateRange.start === record.dateRange.start &&
          existing.dateRange.end === record.dateRange.end &&
          existing.session.tripContext.tags.join("|") ===
            record.session.tripContext.tags.join("|") &&
          existing.name === record.name;
        if (unchanged) {
          if (!options?.setActive || prev.activeTripId === existing.id) {
            return prev;
          }
        }
        trips = [...prev.trips];
        trips[existingIndex] = record;
      } else {
        trips = [record, ...prev.trips];
      }

      const activeTripId = options?.setActive
        ? record.id
        : prev.activeTripId ?? record.id;
      const next = { activeTripId, trips };
      persistTripsState(next);
      return next;
    });
  }

  return {
    persistenceAvailable,
    saveCurrentSession,
    reloadSavedSession,
    trips: state.trips,
    activeTripId: state.activeTripId,
    activeTrip,
    createTrip,
    switchTrip,
    renameTrip,
    deleteTrip,
    upsertTripFromSession,
  };
}

function buildTripMeta(demo: ScriptedDemo, messages: Message[]): TripMeta {
  let receiptCount = 0;
  messages.forEach((message) => {
    message.content.forEach((block) => {
      if (block.type === "receipt_card") {
        receiptCount += 1;
      }
    });
  });
  return {
    bookingsCount: receiptCount,
    receiptCount,
    contextTags: demo.session.tripContext.tags,
  };
}

function loadTripsState(): StoredTripsState {
  const fromStorage = readTripsStateFromStorage();
  if (fromStorage) return fromStorage;

  const seeded = buildSeedTrips();
  persistTripsState(seeded);
  return seeded;
}

function readTripsStateFromStorage(): StoredTripsState | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STITCH_TRIPS_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredTripsState;
    if (!Array.isArray(parsed.trips)) return null;
    if (parsed.trips.length === 0) return null;
    return {
      activeTripId: parsed.activeTripId ?? parsed.trips[0].id,
      trips: parsed.trips,
    };
  } catch {
    return null;
  }
}

function persistTripsState(state: StoredTripsState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STITCH_TRIPS_STORAGE_KEY, JSON.stringify(state));
}

function buildSeedTrips(): StoredTripsState {
  const chicago = loadChicagoMay2024Demo();
  const seededSessions: ScriptedDemo[] = [
    chicago,
    {
      session: {
        ...chicago.session,
        id: "sess-london-june-2026",
        title: "London trip",
        tripContext: {
          destinationLabel: "London",
          dateRange: { start: "2026-06-05", end: "2026-06-10" },
          tags: ["Seed", "London", "Flights", "Hotels"],
        },
      },
      messages: [],
    },
    {
      session: {
        ...chicago.session,
        id: "sess-bali-aug-2026",
        title: "Bali trip",
        tripContext: {
          destinationLabel: "Bali",
          dateRange: { start: "2026-08-01", end: "2026-08-08" },
          tags: ["Seed", "Bali", "Resort"],
        },
      },
      messages: [],
    },
  ];

  const trips = seededSessions.map((demo) => ({
    id: `trip-${demo.session.id}`,
    name: demo.session.title,
    destination: demo.session.tripContext.destinationLabel,
    dateRange: demo.session.tripContext.dateRange,
    session: demo.session,
    messages: demo.messages,
    meta: buildTripMeta(demo, demo.messages),
    updatedAt: new Date().toISOString(),
  }));

  return {
    activeTripId: trips[0]?.id ?? null,
    trips,
  };
}
