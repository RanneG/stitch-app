export type SubscriptionCategory = "streaming" | "music" | "fitness" | "shopping" | "software";

export type SubscriptionStatus = "pending" | "paid" | "snoozed";

export type SubscriptionItem = {
  id: string;
  name: string;
  category: SubscriptionCategory;
  amountUsd: number;
  dueDateIso: string;
  status: SubscriptionStatus;
  /** Gmail account that surfaced this row (Google sign-in). */
  sourceEmail?: string;
};

/** How always-on voice picks speech-to-text (see bridge POST /api/voice/transcribe). */
export type VoiceSttBackend = "auto" | "bridge" | "web_speech";

export type VoiceFaceSettings = {
  voiceActivation: boolean;
  faceMfa: boolean;
  autoApproveUnderUsd: number | null;
  voiceSttBackend: VoiceSttBackend;
};

export type PaymentRecord = {
  id: string;
  subscriptionId: string;
  subscriptionName: string;
  amountUsd: number;
  approvedAtIso: string;
  method: "auto" | "manual";
};

export const DEFAULT_SETTINGS: VoiceFaceSettings = {
  voiceActivation: true,
  faceMfa: true,
  autoApproveUnderUsd: 10,
  voiceSttBackend: "auto",
};

export const SUBSCRIPTION_FIXTURES: SubscriptionItem[] = [
  {
    id: "sub-netflix",
    name: "Netflix",
    category: "streaming",
    amountUsd: 15.99,
    dueDateIso: "2026-05-01",
    status: "pending",
  },
  {
    id: "sub-spotify",
    name: "Spotify",
    category: "music",
    amountUsd: 11.99,
    dueDateIso: "2026-05-05",
    status: "pending",
  },
  {
    id: "sub-gym",
    name: "Gym",
    category: "fitness",
    amountUsd: 49.99,
    dueDateIso: "2026-05-10",
    status: "pending",
  },
  {
    id: "sub-hulu",
    name: "Hulu",
    category: "streaming",
    amountUsd: 7.99,
    dueDateIso: "2026-05-15",
    status: "pending",
  },
  {
    id: "sub-prime",
    name: "Amazon Prime",
    category: "shopping",
    amountUsd: 14.99,
    dueDateIso: "2026-05-20",
    status: "pending",
  },
];

export function cloneSubscriptionFixtures() {
  return SUBSCRIPTION_FIXTURES.map((item) => ({ ...item }));
}
