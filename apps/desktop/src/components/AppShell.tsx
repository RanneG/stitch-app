import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { STITCH_APP_NAME } from "@stitch/shared";
import {
  DEFAULT_SETTINGS,
  type PaymentRecord,
  type SubscriptionItem,
  type VoiceFaceSettings,
  type VoiceSttBackend,
} from "../fixtures/subscriptions";
import { Dashboard } from "./Dashboard";
import { StitchHelpView } from "./StitchHelpView";
import { FaceVerificationPanel } from "./FaceVerificationPanel";
import { GamifiedSettingsView } from "./GamifiedSettingsView";
import { bumpGamifyOnApproval } from "./gamifyStorage";
import {
  readStitchVoiceInputDeviceId,
  STITCH_VOICE_INPUT_DEVICE_CHANGED,
  STITCH_VOICE_INPUT_DEVICE_LS,
  writeStitchVoiceInputDeviceId,
} from "../lib/voiceInputDevice";
import {
  authHeaders,
  readJsonFromResponse,
  readSessionId,
  stitchFetch,
  writeDemoMagicAuth,
  writeSessionId,
} from "../lib/stitchBridge";
import { type BridgeVoicePhase, startBridgeVoiceStt } from "./bridgeVoiceStt";
import { SettingsToggleRow } from "./SettingsToggleRow";
import { VoiceQuestPill } from "./VoiceQuestPill";
import { matchStitchVoiceCommand, matchSubscriptionByVoiceQuery } from "./voiceCommands";
import { useTheme } from "../context/ThemeContext";

/** Active `SpeechRecognition` from the main voice listener â€” stopped briefly during Settings mic test. */
let stitchLiveSpeechRecognitionInstance: { stop: () => void } | null = null;
/** Mic â†’ bridge `/api/voice/transcribe` loop â€” stopped with Web Speech during Settings mic test. */
let stitchBridgeVoiceStop: (() => void) | null = null;

function stitchVoiceTestExclusiveActive(): boolean {
  try {
    return Boolean((window as Window & { __STITCH_VOICE_TEST_ACTIVE?: boolean }).__STITCH_VOICE_TEST_ACTIVE);
  } catch {
    return false;
  }
}

/** Demo auth: account email for local face DB + panels (replace with real auth when you wire it). */
const STITCH_AUTH_EMAIL_KEY = "stitch.userEmail";

function readAuthEmail(): string {
  if (typeof window === "undefined") return "";
  try {
    return (localStorage.getItem(STITCH_AUTH_EMAIL_KEY) || "").trim();
  } catch {
    return "";
  }
}

const STITCH_SIDEBAR_STORAGE_KEY = "stitch.subscriptions.sidebar.v1";
const STITCH_RENEWAL_CALENDAR_KEY = "stitch.renewalCalendar.v1";
const STITCH_VOICE_FACE_SETTINGS_KEY = "stitch.voiceFaceSettings.v1";
const DUE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

function readRenewalCalendarFromStorage(): { year: number; monthIndex: number } {
  const now = new Date();
  const fallback = { year: now.getFullYear(), monthIndex: now.getMonth() };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(STITCH_RENEWAL_CALENDAR_KEY);
    if (!raw) return fallback;
    const o = JSON.parse(raw) as { year?: unknown; monthIndex?: unknown };
    const year = typeof o.year === "number" && Number.isFinite(o.year) ? o.year : fallback.year;
    const monthIndex =
      typeof o.monthIndex === "number" && o.monthIndex >= 0 && o.monthIndex <= 11 ? Math.floor(o.monthIndex) : fallback.monthIndex;
    return { year, monthIndex };
  } catch {
    return fallback;
  }
}

function readVoiceFaceSettingsFromStorage(): VoiceFaceSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STITCH_VOICE_FACE_SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const o = JSON.parse(raw) as Partial<VoiceFaceSettings>;
    const vb = o.voiceSttBackend;
    const voiceSttBackend: VoiceSttBackend =
      vb === "auto" || vb === "bridge" || vb === "web_speech" ? vb : DEFAULT_SETTINGS.voiceSttBackend;
    const aa = o.autoApproveUnderUsd;
    const autoApproveUnderUsd =
      aa === null || (typeof aa === "number" && Number.isFinite(aa) && aa >= 0) ? aa : DEFAULT_SETTINGS.autoApproveUnderUsd;
    return {
      voiceActivation: typeof o.voiceActivation === "boolean" ? o.voiceActivation : DEFAULT_SETTINGS.voiceActivation,
      faceMfa: typeof o.faceMfa === "boolean" ? o.faceMfa : DEFAULT_SETTINGS.faceMfa,
      autoApproveUnderUsd,
      voiceSttBackend,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function readSidebarExpandedFromStorage(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(STITCH_SIDEBAR_STORAGE_KEY);
    if (!raw) return true;
    const parsed = JSON.parse(raw) as { expanded?: boolean };
    return parsed.expanded !== false;
  } catch {
    return true;
  }
}

function persistSidebarExpanded(expanded: boolean) {
  try {
    window.localStorage.setItem(STITCH_SIDEBAR_STORAGE_KEY, JSON.stringify({ expanded }));
  } catch {
    // ignore persistence failures
  }
}

function friendlyErrorMessage(raw: string): string {
  const t = raw.toLowerCase();
  if (/oauth|google_oauth|not configured|client_id|client_secret/.test(t)) {
    return "ðŸ”§ Setup needed â€” let's connect Google in ~2 minutes (see the hero card).";
  }
  if (/network|failed to fetch|8765|html instead of json|bridge|could not reach/i.test(t)) {
    return "ðŸ”„ Something glitched â€” check the bridge, then try again?";
  }
  if (/sign in with google/.test(t)) {
    return "ðŸ” Link Google first to sync subscription quests.";
  }
  return raw;
}

type SessionProfile = { email: string; pictureUrl: string | null };

export function AppShell({
  onAuthGateRefresh,
  onLogoutSuccess,
}: {
  onAuthGateRefresh?: () => void | Promise<void>;
  onLogoutSuccess?: (message: string) => void;
}) {
  const [view, setView] = useState<"upcoming" | "history" | "settings" | "help">("upcoming");
  const [leftRailExpanded, setLeftRailExpanded] = useState(readSidebarExpandedFromStorage);
  const [subscriptions, setSubscriptions] = useState<SubscriptionItem[]>([]);
  const [subscriptionsLoading, setSubscriptionsLoading] = useState(false);
  const [subscriptionsMutating, setSubscriptionsMutating] = useState(false);
  const [googleSignedIn, setGoogleSignedIn] = useState(() => Boolean(readSessionId()));
  const [history, setHistory] = useState<PaymentRecord[]>([]);
  const [settings, setSettings] = useState<VoiceFaceSettings>(() => readVoiceFaceSettingsFromStorage());
  const [statusText, setStatusText] = useState("Monitoring subscription renewals.");
  const [toastError, setToastError] = useState<string | null>(null);
  const [toastSuccess, setToastSuccess] = useState<string | null>(null);
  const [voiceListening, setVoiceListening] = useState(false);
  /** Full Web Speech transcript snapshot (interim + final) for the live listener â€” updates on every `onresult`. */
  const [voiceSpeechEcho, setVoiceSpeechEcho] = useState("");
  const [voiceSpeechError, setVoiceSpeechError] = useState<string | null>(null);
  const [pendingApprovalId, setPendingApprovalId] = useState<string | null>(null);
  const [pingSubscriptionId, setPingSubscriptionId] = useState<string | null>(null);
  const [faceModalOpen, setFaceModalOpen] = useState(false);
  const [confettiTrigger, setConfettiTrigger] = useState(0);
  const [gamifyRefreshTick, setGamifyRefreshTick] = useState(0);
  const pendingApprovalRef = useRef<SubscriptionItem | null>(null);
  const startApprovalRef = useRef<(subscription: SubscriptionItem, source: "button" | "voice" | "auto") => Promise<void>>(
    async () => undefined,
  );
  const [displayYear, setDisplayYear] = useState(() => readRenewalCalendarFromStorage().year);
  const [displayMonthIndex, setDisplayMonthIndex] = useState(() => readRenewalCalendarFromStorage().monthIndex);
  useEffect(() => {
    try {
      window.localStorage.setItem(
        STITCH_RENEWAL_CALENDAR_KEY,
        JSON.stringify({ year: displayYear, monthIndex: displayMonthIndex }),
      );
    } catch {
      /* ignore */
    }
  }, [displayYear, displayMonthIndex]);
  const [voiceSupported, setVoiceSupported] = useState(false);
  /** Bumped when Settings voice test ends so the live listener effect restarts cleanly. */
  const [voiceMicTestResumeEpoch, setVoiceMicTestResumeEpoch] = useState(0);
  /** `null` until GET /api/health â€” whether `POST /api/voice/transcribe` is available. */
  const [voiceBridgeSttOk, setVoiceBridgeSttOk] = useState<boolean | null>(null);
  /** From `/api/health` `voice_stt.engine` â€” `whisper`, `google`, etc. */
  const [voiceBridgeSttEngine, setVoiceBridgeSttEngine] = useState<string | null>(null);
  const [voiceBridgePhase, setVoiceBridgePhase] = useState<BridgeVoicePhase | null>(null);
  const [voiceBridgeMicLevel, setVoiceBridgeMicLevel] = useState(0);
  const bridgeMicRaf = useRef<number | null>(null);
  const bridgeMicLevelPending = useRef(0);
  const [voiceInputDeviceId, setVoiceInputDeviceId] = useState(() => readStitchVoiceInputDeviceId());

  const commitVoiceInputDeviceId = useCallback((id: string) => {
    writeStitchVoiceInputDeviceId(id);
    setVoiceInputDeviceId(readStitchVoiceInputDeviceId());
  }, []);

  useEffect(() => {
    const sync = () => setVoiceInputDeviceId(readStitchVoiceInputDeviceId());
    window.addEventListener(STITCH_VOICE_INPUT_DEVICE_CHANGED, sync as EventListener);
    const onStorage = (e: StorageEvent) => {
      if (e.key === STITCH_VOICE_INPUT_DEVICE_LS || e.key === null) sync();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(STITCH_VOICE_INPUT_DEVICE_CHANGED, sync as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  /** What the user is typing in Settings (do not pass live to FaceVerificationPanel â€” it would bootstrap / open camera every keystroke). */
  const [authEmailDraft, setAuthEmailDraft] = useState<string>(() => readAuthEmail());
  /** Last saved email; face panel + localStorage only update from this. */
  const [authEmailCommitted, setAuthEmailCommitted] = useState<string>(() => readAuthEmail());
  const [sessionProfile, setSessionProfile] = useState<SessionProfile | null>(null);
  const [settingsAccountTabSignal, setSettingsAccountTabSignal] = useState(0);
  const [settingsBillingTabSignal, setSettingsBillingTabSignal] = useState(0);
  const [settingsVoiceTabSignal, setSettingsVoiceTabSignal] = useState(0);
  const [settingsAlertsTabSignal, setSettingsAlertsTabSignal] = useState(0);
  const [settingsFaceTabSignal, setSettingsFaceTabSignal] = useState(0);
  const [settingsAppearanceTabSignal, setSettingsAppearanceTabSignal] = useState(0);
  const [gmailDiscoverSignal, setGmailDiscoverSignal] = useState(0);
  const [ragVoiceRun, setRagVoiceRun] = useState<{ id: number; query: string } | null>(null);
  const { setMode, committed: themeCommitted } = useTheme();

  const mapApiSubscription = useCallback((raw: unknown): SubscriptionItem | null => {
    if (!raw || typeof raw !== "object") return null;
    const row = raw as {
      id?: unknown;
      name?: unknown;
      category?: unknown;
      amountUsd?: unknown;
      dueDateIso?: unknown;
      status?: unknown;
      sourceEmail?: unknown;
    };
    const id = typeof row.id === "string" ? row.id : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!id || !name) return null;
    const category = String(row.category || "software");
    const normalizedCategory: SubscriptionItem["category"] = (
      category === "streaming" || category === "music" || category === "fitness" || category === "shopping" ? category : "software"
    ) as SubscriptionItem["category"];
    const amount = Number(row.amountUsd ?? 0);
    const status = String(row.status || "pending");
    const normalizedStatus: SubscriptionItem["status"] = status === "paid" ? "paid" : "pending";
    return {
      id,
      name,
      category: normalizedCategory,
      amountUsd: Number.isFinite(amount) ? amount : 0,
      dueDateIso: typeof row.dueDateIso === "string" && row.dueDateIso ? row.dueDateIso : new Date().toISOString().slice(0, 10),
      status: normalizedStatus,
      sourceEmail: typeof row.sourceEmail === "string" ? row.sourceEmail : undefined,
    };
  }, []);

  const showErrorToast = useCallback((message: string) => {
    const text = friendlyErrorMessage(message);
    setToastError(text);
    window.setTimeout(() => setToastError((curr) => (curr === text ? null : curr)), 4500);
  }, []);

  const showSuccessToast = useCallback((message: string) => {
    setToastSuccess(message);
    window.setTimeout(() => setToastSuccess((curr) => (curr === message ? null : curr)), 4000);
  }, []);

  const loadSubscriptions = useCallback(
    async (opts?: { silent?: boolean }) => {
      const sid = readSessionId();
      if (!sid) {
        setSubscriptions([]);
        setGoogleSignedIn(false);
        return;
      }
      if (!opts?.silent) setSubscriptionsLoading(true);
      try {
        const res = await stitchFetch("/api/subscriptions/list", {
          method: "GET",
          headers: authHeaders(sid),
        });
        const { data, parseError } = await readJsonFromResponse(res);
        if (parseError) {
          showErrorToast(parseError);
          return;
        }
        if (!res.ok) {
          const err = (data as { error?: string } | null)?.error || "Failed to load subscriptions.";
          showErrorToast(err);
          return;
        }
        const rows = ((data as { subscriptions?: unknown[] } | null)?.subscriptions || [])
          .map(mapApiSubscription)
          .filter((r): r is SubscriptionItem => Boolean(r));
        setSubscriptions(rows);
        setGoogleSignedIn(true);
      } catch {
        showErrorToast("Could not reach Stitch bridge.");
      } finally {
        if (!opts?.silent) setSubscriptionsLoading(false);
      }
    },
    [mapApiSubscription, showErrorToast],
  );

  const upsertSubscriptions = useCallback(
    async (items: SubscriptionItem[]) => {
      const sid = readSessionId();
      if (!sid) {
        showErrorToast("Sign in with Google before editing subscriptions.");
        return false;
      }
      setSubscriptionsMutating(true);
      try {
        const res = await stitchFetch("/api/subscriptions/upsert", {
          method: "POST",
          headers: authHeaders(sid),
          body: JSON.stringify({ subscriptions: items }),
        });
        const { data, parseError } = await readJsonFromResponse(res);
        if (parseError || !res.ok) {
          const err = parseError || (data as { error?: string } | null)?.error || "Failed to save subscription.";
          showErrorToast(err);
          return false;
        }
        await loadSubscriptions({ silent: true });
        return true;
      } catch {
        showErrorToast("Subscription save failed.");
        return false;
      } finally {
        setSubscriptionsMutating(false);
      }
    },
    [loadSubscriptions, showErrorToast],
  );

  const deleteSubscription = useCallback(
    async (id: string) => {
      const sid = readSessionId();
      if (!sid) {
        showErrorToast("Sign in with Google before deleting subscriptions.");
        return;
      }
      setSubscriptionsMutating(true);
      try {
        const res = await stitchFetch("/api/subscriptions/delete", {
          method: "POST",
          headers: authHeaders(sid),
          body: JSON.stringify({ id }),
        });
        const { data, parseError } = await readJsonFromResponse(res);
        if (parseError || !res.ok) {
          const err = parseError || (data as { error?: string } | null)?.error || "Failed to delete subscription.";
          showErrorToast(err);
          return;
        }
        await loadSubscriptions({ silent: true });
        setStatusText("Subscription removed.");
      } catch {
        showErrorToast("Subscription delete failed.");
      } finally {
        setSubscriptionsMutating(false);
      }
    },
    [loadSubscriptions, showErrorToast],
  );

  const addSubscription = useCallback(
    async (item: SubscriptionItem) => {
      const ok = await upsertSubscriptions([item]);
      if (ok) setStatusText(`Added â€œ${item.name}â€.`);
    },
    [upsertSubscriptions],
  );

  const refreshSessionProfile = useCallback(async () => {
    const sid = readSessionId();
    if (!sid) {
      setSessionProfile(null);
      return;
    }
    try {
      const res = await stitchFetch("/api/auth/status", { headers: authHeaders(sid) });
      const { data, parseError } = await readJsonFromResponse(res);
      if (parseError || !data || typeof data !== "object") {
        setSessionProfile(null);
        return;
      }
      const d = data as {
        authenticated?: boolean;
        accounts?: Array<{ id: number; email: string; pictureUrl?: string | null }>;
        activeEmail?: string | null;
        invalidSession?: boolean;
      };
      if (d.invalidSession || !d.authenticated) {
        setSessionProfile(null);
        return;
      }
      const accounts = d.accounts || [];
      if (accounts.length === 0) {
        setSessionProfile(null);
        return;
      }
      const active = (d.activeEmail || "").trim() || accounts[0]!.email;
      const primary = accounts.find((a) => a.email === active) ?? accounts[0]!;
      setSessionProfile({ email: primary.email, pictureUrl: primary.pictureUrl ?? null });
    } catch {
      setSessionProfile(null);
    }
  }, []);

  const onAuthSessionChange = useCallback(() => {
    setGoogleSignedIn(Boolean(readSessionId()));
    void loadSubscriptions();
    void refreshSessionProfile();
    onAuthGateRefresh?.();
  }, [loadSubscriptions, onAuthGateRefresh, refreshSessionProfile]);

  const performLogout = useCallback(async () => {
    const sid = readSessionId();
    if (sid) {
      await stitchFetch("/api/auth/logout", { method: "POST", headers: authHeaders(sid) }).catch(() => undefined);
    }
    writeSessionId(null);
    writeDemoMagicAuth(false);
    try {
      window.localStorage.removeItem(STITCH_AUTH_EMAIL_KEY);
    } catch {
      /* ignore */
    }
    setAuthEmailDraft("");
    setAuthEmailCommitted("");
    setSessionProfile(null);
    setGoogleSignedIn(false);
    setSubscriptions([]);
    await onAuthGateRefresh?.();
    onLogoutSuccess?.("Signed out successfully.");
  }, [onAuthGateRefresh, onLogoutSuccess]);

  const commitAuthEmail = useCallback(() => {
    const trimmed = authEmailDraft.trim();
    setAuthEmailDraft(trimmed);
    setAuthEmailCommitted(trimmed);
    try {
      if (trimmed) window.localStorage.setItem(STITCH_AUTH_EMAIL_KEY, trimmed);
      else window.localStorage.removeItem(STITCH_AUTH_EMAIL_KEY);
    } catch {
      // ignore quota / private mode
    }
  }, [authEmailDraft]);

  const onGoogleLinkedEmail = useCallback((email: string) => {
    const trimmed = email.trim();
    if (!trimmed) return;
    setAuthEmailDraft(trimmed);
    setAuthEmailCommitted(trimmed);
    try {
      window.localStorage.setItem(STITCH_AUTH_EMAIL_KEY, trimmed);
    } catch {
      /* ignore */
    }
    setGoogleSignedIn(Boolean(readSessionId()));
    void loadSubscriptions();
    void refreshSessionProfile();
  }, [loadSubscriptions, refreshSessionProfile]);

  useEffect(() => {
    void loadSubscriptions();
  }, [loadSubscriptions]);

  useEffect(() => {
    if (view !== "settings") setRagVoiceRun(null);
  }, [view]);

  useEffect(() => {
    if (googleSignedIn) void refreshSessionProfile();
    else setSessionProfile(null);
  }, [googleSignedIn, refreshSessionProfile]);

  const pendingApproval = useMemo(
    () => subscriptions.find((sub) => sub.id === pendingApprovalId) ?? null,
    [pendingApprovalId, subscriptions],
  );
  pendingApprovalRef.current = pendingApproval;
  const pingSubscription = useMemo(
    () => subscriptions.find((sub) => sub.id === pingSubscriptionId) ?? null,
    [pingSubscriptionId, subscriptions],
  );

  useEffect(() => {
    setVoiceSupported("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
  }, []);

  useEffect(() => {
    const pauseLive = () => {
      try {
        stitchLiveSpeechRecognitionInstance?.stop();
      } catch {
        /* ignore */
      }
      try {
        stitchBridgeVoiceStop?.();
      } catch {
        /* ignore */
      }
    };
    const onTestFinished = () => {
      setVoiceMicTestResumeEpoch((n) => n + 1);
    };
    window.addEventListener("stitch-voice-test-pause", pauseLive);
    window.addEventListener("stitch-voice-test-finished", onTestFinished);
    return () => {
      window.removeEventListener("stitch-voice-test-pause", pauseLive);
      window.removeEventListener("stitch-voice-test-finished", onTestFinished);
    };
  }, []);

  useEffect(() => {
    const checkDuePayments = () => {
      const now = Date.now();
      const dueSoon = subscriptions.find((sub) => {
        if (sub.status !== "pending") return false;
        const dueAt = new Date(`${sub.dueDateIso}T00:00:00`).getTime();
        return (dueAt - now) / (24 * 60 * 60 * 1000) <= 1;
      });
      if (!dueSoon) return;
      setPingSubscriptionId(dueSoon.id);
      setStatusText(`${dueSoon.name} is due soon.`);
      void showDesktopPing(dueSoon);
    };
    checkDuePayments();
    const timer = window.setInterval(checkDuePayments, DUE_CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [subscriptions]);

  function cancelFaceApproval() {
    setFaceModalOpen(false);
    setPendingApprovalId(null);
    setStatusText("Face verification cancelled.");
  }

  async function showDesktopPing(subscription: SubscriptionItem) {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted") {
      new Notification(`${subscription.name} due soon`, {
        body: `$${subscription.amountUsd.toFixed(2)} due ${formatDate(subscription.dueDateIso)}.`,
      });
      return;
    }
    if (Notification.permission === "default") {
      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        new Notification(`${subscription.name} due soon`, {
          body: `$${subscription.amountUsd.toFixed(2)} due ${formatDate(subscription.dueDateIso)}.`,
        });
      }
    }
  }

  function runDueCheckNow() {
    const now = Date.now();
    const dueSoon = subscriptions.find((sub) => {
      if (sub.status !== "pending") return false;
      const dueAt = new Date(`${sub.dueDateIso}T00:00:00`).getTime();
      return (dueAt - now) / (24 * 60 * 60 * 1000) <= 1;
    });
    if (!dueSoon) {
      setStatusText("No charges due in the next 24 hours.");
      return;
    }
    setPingSubscriptionId(dueSoon.id);
    setStatusText(`Ping sent for ${dueSoon.name}.`);
  }

  async function startApproval(subscription: SubscriptionItem, source: "button" | "voice" | "auto") {
    if (subscription.status !== "pending") return;
    const threshold = settings.autoApproveUnderUsd;
    if (source !== "auto" && threshold != null && subscription.amountUsd < threshold) {
      await completeApproval(subscription, "auto");
      return;
    }
    setPendingApprovalId(subscription.id);
    if (settings.faceMfa) {
      setFaceModalOpen(true);
      return;
    }
    await completeApproval(subscription, source === "auto" ? "auto" : "manual");
  }

  async function completeApproval(subscription: SubscriptionItem, method: "auto" | "manual") {
    const updated = { ...subscription, status: "paid" as const };
    const ok = await upsertSubscriptions([updated]);
    if (!ok) return;
    setHistory((prev) => [
      {
        id: `payment-${Date.now()}`,
        subscriptionId: subscription.id,
        subscriptionName: subscription.name,
        amountUsd: subscription.amountUsd,
        approvedAtIso: new Date().toISOString(),
        method,
      },
      ...prev,
    ]);
    setPendingApprovalId(null);
    setPingSubscriptionId(null);
    setFaceModalOpen(false);
    bumpGamifyOnApproval();
    setGamifyRefreshTick((n) => n + 1);
    setConfettiTrigger((n) => n + 1);
    setStatusText(
      `${subscription.name} payment approved ${method === "auto" ? "automatically" : "with MFA"}.`,
    );
  }

  startApprovalRef.current = startApproval;

  const dispatchStitchVoiceUtterance = useCallback((trimmed: string) => {
    const transcriptLower = trimmed.toLowerCase();
    const pending = pendingApprovalRef.current;
    if (pending && transcriptLower.includes("approve")) {
      void startApprovalRef.current(pending, "voice");
      return;
    }
    const cmd = matchStitchVoiceCommand(trimmed);
    if (!cmd) return;
    switch (cmd.type) {
      case "open_rag":
        setRagVoiceRun(null);
        setView("settings");
        setSettingsBillingTabSignal((n) => n + 1);
        window.setTimeout(() => {
          document.getElementById("stitch-linkup-rag")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 120);
        setStatusText("Opened document brain (Settings â†’ Billing).");
        break;
      case "rag_query":
        setView("settings");
        setSettingsBillingTabSignal((n) => n + 1);
        window.setTimeout(() => {
          setRagVoiceRun({ id: Date.now(), query: cmd.query });
          document.getElementById("stitch-linkup-rag")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 100);
        setStatusText("Running your document questionâ€¦");
        break;
      case "open_help":
        setView("help");
        setStatusText("Help & support.");
        break;
      case "open_settings":
        setView("settings");
        setStatusText("Settings.");
        break;
      case "open_account":
        setView("settings");
        setSettingsAccountTabSignal((n) => n + 1);
        window.requestAnimationFrame(() => {
          document.getElementById("settings-tab-account")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          document.getElementById("settings-panel-account")?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        setStatusText("Account settings.");
        break;
      case "open_voice":
        setView("settings");
        setSettingsVoiceTabSignal((n) => n + 1);
        window.requestAnimationFrame(() => {
          document.getElementById("settings-tab-voice")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          document.getElementById("settings-panel-voice")?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        setStatusText("Voice settings.");
        break;
      case "open_alerts":
        setView("settings");
        setSettingsAlertsTabSignal((n) => n + 1);
        window.requestAnimationFrame(() => {
          document.getElementById("settings-tab-alerts")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          document.getElementById("settings-panel-alerts")?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        setStatusText("Alerts settings.");
        break;
      case "open_face":
        setView("settings");
        setSettingsFaceTabSignal((n) => n + 1);
        window.requestAnimationFrame(() => {
          document.getElementById("settings-tab-faceVerification")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          document.getElementById("settings-panel-faceVerification")?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        setStatusText("Face verification.");
        break;
      case "open_appearance":
        setView("settings");
        setSettingsAppearanceTabSignal((n) => n + 1);
        window.requestAnimationFrame(() => {
          document.getElementById("settings-tab-appearance")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          document.getElementById("settings-panel-appearance")?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        setStatusText("Appearance settings.");
        break;
      case "open_billing":
        setView("settings");
        setSettingsBillingTabSignal((n) => n + 1);
        window.requestAnimationFrame(() => {
          document.getElementById("settings-tab-billing")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          document.getElementById("settings-panel-billing")?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        setStatusText("Billing / document brain tab.");
        break;
      case "open_history":
        setView("history");
        setStatusText("Payment history.");
        break;
      case "open_upcoming":
        setView("upcoming");
        setStatusText("Upcoming renewals.");
        break;
      case "scan_gmail":
        if (!readSessionId()) {
          setStatusText("Sign in with Google to scan Gmail.");
          break;
        }
        setView("upcoming");
        window.setTimeout(() => {
          setGmailDiscoverSignal((n) => n + 1);
          document.getElementById("stitch-gmail-discovery")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 0);
        setStatusText("Scanning subscriptions from emailâ€¦");
        break;
      case "set_theme":
        setMode(cmd.mode);
        setStatusText(cmd.mode === "dark" ? "Switched to dark mode." : "Switched to light mode.");
        break;
      case "toggle_theme":
        setMode(themeCommitted.mode === "dark" ? "light" : "dark");
        setStatusText("Theme toggled.");
        break;
      case "pay_subscription": {
        const hit = matchSubscriptionByVoiceQuery(subscriptions, cmd.nameQuery);
        if (!hit) {
          setStatusText(`No pending subscription matched â€œ${cmd.nameQuery}â€. Say the name as it appears on Upcoming.`);
          break;
        }
        setView("upcoming");
        void startApprovalRef.current(hit, "voice");
        setStatusText(`Starting payment for ${hit.name}â€¦`);
        break;
      }
      default:
        break;
    }
  }, [subscriptions, setMode, themeCommitted.mode]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await stitchFetch("/api/health");
        const parsed = await readJsonFromResponse(res);
        if (cancelled) return;
        if (parsed.parseError || !parsed.data || typeof parsed.data !== "object") {
          setVoiceBridgeSttOk(false);
          return;
        }
        const vs = (parsed.data as { voice_stt?: { ok?: boolean; engine?: string } }).voice_stt;
        setVoiceBridgeSttOk(Boolean(vs?.ok));
        setVoiceBridgeSttEngine(typeof vs?.engine === "string" && vs.engine ? vs.engine : null);
      } catch {
        if (!cancelled) setVoiceBridgeSttOk(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settings.voiceActivation]);

  const voiceEchoSource = useMemo<"web" | "bridge" | "none">(() => {
    if (!settings.voiceActivation) return "none";
    if (settings.voiceSttBackend === "bridge") return "bridge";
    if (settings.voiceSttBackend === "web_speech") return "web";
    return voiceBridgeSttOk === true ? "bridge" : "web";
  }, [settings.voiceActivation, settings.voiceSttBackend, voiceBridgeSttOk]);

  useEffect(() => {
    if (!settings.voiceActivation) {
      setVoiceListening(false);
      setVoiceSpeechEcho("");
      setVoiceSpeechError(null);
      return;
    }
    const wantWeb =
      settings.voiceSttBackend === "web_speech" ||
      (settings.voiceSttBackend === "auto" && voiceBridgeSttOk !== true);
    if (!wantWeb || !voiceSupported) {
      if (settings.voiceActivation && wantWeb && !voiceSupported) {
        setVoiceSpeechError("Web Speech is not available in this host. Run stitch_rag_bridge.py and keep Speech engine on Auto or Local bridge.");
      }
      return;
    }

    type SpeechCtor = new () => {
      continuous: boolean;
      lang: string;
      interimResults: boolean;
      onstart: (() => void) | null;
      onend: (() => void) | null;
      onerror: ((event: { error?: string }) => void) | null;
      onresult:
        | ((
            event: {
              resultIndex: number;
              results: ArrayLike<{ 0?: { transcript?: string }; isFinal?: boolean }>;
            },
          ) => void)
        | null;
      start: () => void;
      stop: () => void;
    };
    const W = window as Window & {
      SpeechRecognition?: SpeechCtor;
      webkitSpeechRecognition?: SpeechCtor;
    };
    const Recognition = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Recognition) return;

    const recognition = new Recognition();
    stitchLiveSpeechRecognitionInstance = recognition;
    let cancelled = false;
    recognition.continuous = true;
    recognition.lang = "en-US";
    /** Final-only handling per resultIndex â€” `false` often yields fewer / no `onresult` callbacks in long-lived Chrome sessions. */
    recognition.interimResults = true;
    recognition.onstart = () => {
      setVoiceListening(true);
      setVoiceSpeechError(null);
    };
    recognition.onend = () => {
      setVoiceListening(false);
      if (cancelled) return;
      if (stitchVoiceTestExclusiveActive()) return;
      window.setTimeout(() => {
        if (cancelled) return;
        if (stitchVoiceTestExclusiveActive()) return;
        try {
          recognition.start();
        } catch {
          /* InvalidStateError: already running */
        }
      }, 200);
    };
    recognition.onerror = (event) => {
      const code = event.error || "";
      if (code === "no-speech" || code === "aborted") return;
      if (code === "not-allowed") {
        setVoiceSpeechError("Speech blocked â€” allow microphone for this site (browser address bar).");
        setStatusText("Microphone blocked for speech â€” allow the site to use the mic, or turn off Voice activation in Settings.");
        return;
      }
      if (code === "audio-capture") {
        setVoiceSpeechError("Speech could not start â€” no microphone for recognition.");
        return;
      }
      if (code === "network") {
        setVoiceSpeechError(
          "Speech network error â€” Web Speech needs the cloud; try external Chrome/Edge if you use the desktop shell.",
        );
        return;
      }
      if (code === "service-not-allowed") {
        setVoiceSpeechError("Speech service not allowed in this environment â€” open Stitch in Chrome or Edge.");
        return;
      }
      setVoiceSpeechError(`Speech recognition: ${code || "error"}`);
    };
    recognition.onresult = (event) => {
      let combined = "";
      for (let j = 0; j < event.results.length; j++) {
        combined += event.results[j]?.[0]?.transcript ?? "";
      }
      const capped = combined.trimEnd();
      if (capped.length > 800) setVoiceSpeechEcho(`â€¦${capped.slice(-800)}`);
      else setVoiceSpeechEcho(capped);

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const row = event.results[i];
        if (!row || !row.isFinal) continue;
        const raw = row[0]?.transcript ?? "";
        const trimmed = raw.trim();
        if (!trimmed) continue;
        dispatchStitchVoiceUtterance(trimmed);
      }
    };
    try {
      recognition.start();
    } catch {
      setVoiceListening(false);
    }
    return () => {
      cancelled = true;
      if (stitchLiveSpeechRecognitionInstance === recognition) {
        stitchLiveSpeechRecognitionInstance = null;
      }
      try {
        recognition.stop();
      } catch {
        /* ignore */
      }
    };
  }, [
    settings.voiceActivation,
    settings.voiceSttBackend,
    voiceBridgeSttOk,
    voiceSupported,
    voiceMicTestResumeEpoch,
    dispatchStitchVoiceUtterance,
  ]);

  const scheduleBridgeMicLevel = useCallback((v: number) => {
    bridgeMicLevelPending.current = v;
    if (bridgeMicRaf.current != null) return;
    bridgeMicRaf.current = window.requestAnimationFrame(() => {
      bridgeMicRaf.current = null;
      setVoiceBridgeMicLevel(bridgeMicLevelPending.current);
    });
  }, []);

  useEffect(() => {
    if (!settings.voiceActivation) {
      setVoiceSpeechEcho("");
      setVoiceSpeechError(null);
      setVoiceBridgePhase(null);
      setVoiceBridgeMicLevel(0);
      if (bridgeMicRaf.current != null) {
        window.cancelAnimationFrame(bridgeMicRaf.current);
        bridgeMicRaf.current = null;
      }
      stitchBridgeVoiceStop?.();
      stitchBridgeVoiceStop = null;
      return;
    }
    const wantBridge =
      settings.voiceSttBackend === "bridge" ||
      (settings.voiceSttBackend === "auto" && voiceBridgeSttOk === true);
    if (!wantBridge) return;
    if (voiceBridgeSttOk !== true) {
      if (settings.voiceSttBackend === "bridge") {
        setVoiceSpeechError(
          "Local voice STT is not available â€” install the bridge deps (SpeechRecognition) and restart stitch_rag_bridge.py, or switch Speech engine to Auto.",
        );
      }
      return;
    }
    setVoiceSpeechError(null);
    const stop = startBridgeVoiceStt(
      {
        onUtterance: dispatchStitchVoiceUtterance,
        onCaption: (t) => {
          const line = t.startsWith("[") ? t : `[bridge] ${t}`;
          setVoiceSpeechEcho(line.length > 800 ? `â€¦${line.slice(-800)}` : line);
        },
        onListening: (on) => setVoiceListening(on),
        onError: (m) => setVoiceSpeechError(m),
        onPhase: (phase) => setVoiceBridgePhase(phase),
        onLevel: (level01) => scheduleBridgeMicLevel(level01),
      },
      { inputDeviceId: voiceInputDeviceId },
    );
    stitchBridgeVoiceStop = stop;
    return () => {
      stitchBridgeVoiceStop = null;
      setVoiceBridgePhase(null);
      setVoiceBridgeMicLevel(0);
      if (bridgeMicRaf.current != null) {
        window.cancelAnimationFrame(bridgeMicRaf.current);
        bridgeMicRaf.current = null;
      }
      stop();
    };
  }, [
    settings.voiceActivation,
    settings.voiceSttBackend,
    voiceBridgeSttOk,
    voiceMicTestResumeEpoch,
    voiceInputDeviceId,
    dispatchStitchVoiceUtterance,
    scheduleBridgeMicLevel,
  ]);

  function toggleSetting<K extends keyof VoiceFaceSettings>(key: K, value: VoiceFaceSettings[K]) {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      try {
        window.localStorage.setItem(STITCH_VOICE_FACE_SETTINGS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const openAccountSettings = useCallback(() => {
    setView("settings");
    setSettingsAccountTabSignal((n) => n + 1);
    window.requestAnimationFrame(() => {
      document.getElementById("settings-tab-account")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      document.getElementById("settings-panel-account")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  const accountEmailDisplay = (sessionProfile?.email || authEmailCommitted.trim() || "").trim();
  const accountPictureUrl = sessionProfile?.pictureUrl ?? null;
  const showLeftRailAccount =
    googleSignedIn && Boolean(sessionProfile?.email || authEmailCommitted.trim());

  return (
    <div className="relative min-h-[100dvh] min-w-0 text-stitch-text">
      <div
        className={`relative z-10 flex min-h-[100dvh] min-w-0 flex-col overflow-x-hidden bg-transparent lg:grid lg:h-[100dvh] lg:max-h-[100dvh] lg:min-h-0 lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden lg:transition-[grid-template-columns] lg:duration-200 lg:ease-out ${
          leftRailExpanded
            ? "lg:grid-cols-[240px_minmax(0,1fr)_280px]"
            : "lg:grid-cols-[64px_minmax(0,1fr)_280px]"
        }`}
      >
      <LeftRail
        activeView={view}
        compact={!leftRailExpanded}
        onToggleCompact={() => {
          setLeftRailExpanded((prev) => {
            const next = !prev;
            persistSidebarExpanded(next);
            return next;
          });
        }}
        onCheckNow={runDueCheckNow}
        onSelectUpcoming={() => setView("upcoming")}
        onSelectHistory={() => setView("history")}
        onSelectSettings={() => setView("settings")}
        onSelectHelp={() => setView("help")}
        accountEmail={accountEmailDisplay}
        accountPictureUrl={accountPictureUrl}
        onOpenAccountSettings={openAccountSettings}
        onLogout={() => void performLogout()}
        showAccountMenu={showLeftRailAccount}
      />
      <CenterPane
        view={view}
        subscriptions={subscriptions}
        subscriptionsLoading={subscriptionsLoading}
        subscriptionsMutating={subscriptionsMutating}
        history={history}
        settings={settings}
        statusText={statusText}
        pendingApproval={pendingApproval}
        faceMfaOpen={faceModalOpen}
        onCancelFaceMfa={cancelFaceApproval}
        onFacePurchaseVerified={() => {
          const sub = pendingApprovalRef.current;
          if (sub) void completeApproval(sub, "manual");
        }}
        onApprove={(subscription) => void startApproval(subscription, "button")}
        onDeleteSubscription={(id) => void deleteSubscription(id)}
        onAddSubscription={(item) => void addSubscription(item)}
        googleSignedIn={googleSignedIn}
        onToggleSetting={toggleSetting}
        authEmailDraft={authEmailDraft}
        onAuthEmailDraftChange={setAuthEmailDraft}
        onAuthEmailCommit={commitAuthEmail}
        accountDisplayEmail={accountEmailDisplay}
        onGoogleLinkedEmail={onGoogleLinkedEmail}
        onAuthSessionChange={onAuthSessionChange}
        onGmailImportSuccess={showSuccessToast}
        onGmailImportError={showErrorToast}
        onSubscriptionsRefresh={() => void loadSubscriptions({ silent: true })}
        confettiTrigger={confettiTrigger}
        gamifyRefreshTick={gamifyRefreshTick}
        onRequestGoogleConnect={() => {
          setView("settings");
          setSettingsAccountTabSignal((n) => n + 1);
          window.requestAnimationFrame(() => {
            document.getElementById("stitch-google-signin")?.scrollIntoView({ behavior: "smooth", block: "start" });
          });
        }}
        settingsAccountTabSignal={settingsAccountTabSignal}
        settingsBillingTabSignal={settingsBillingTabSignal}
        settingsVoiceTabSignal={settingsVoiceTabSignal}
        settingsAlertsTabSignal={settingsAlertsTabSignal}
        settingsFaceTabSignal={settingsFaceTabSignal}
        settingsAppearanceTabSignal={settingsAppearanceTabSignal}
        ragVoiceRun={ragVoiceRun}
        gmailDiscoverSignal={gmailDiscoverSignal}
      />
      <RightRail
        subscriptions={subscriptions}
        displayYear={displayYear}
        displayMonthIndex={displayMonthIndex}
        voiceActivation={settings.voiceActivation}
        onVoiceActivationChange={(next) => toggleSetting("voiceActivation", next)}
        voicePillActive={settings.voiceActivation}
        voicePillListening={voiceListening}
        voicePillSpeechEcho={voiceSpeechEcho}
        voicePillEchoSource={voiceEchoSource}
        voicePillSpeechError={voiceSpeechError}
        voicePillBridgePhase={voiceBridgePhase}
        voicePillBridgeMicLevel={voiceBridgeMicLevel}
        voicePillBridgeEngine={voiceBridgeSttEngine}
        voicePillInputDeviceId={voiceInputDeviceId}
        onVoicePillInputDeviceIdChange={commitVoiceInputDeviceId}
        voicePillPendingLabel={pendingApproval?.name ?? null}
        onVoicePillApproveByVoice={() => {
          if (pendingApproval) void startApproval(pendingApproval, "voice");
        }}
        onPrevMonth={() => {
          if (displayMonthIndex === 0) {
            setDisplayMonthIndex(11);
            setDisplayYear((prev) => prev - 1);
            return;
          }
          setDisplayMonthIndex((prev) => prev - 1);
        }}
        onNextMonth={() => {
          if (displayMonthIndex === 11) {
            setDisplayMonthIndex(0);
            setDisplayYear((prev) => prev + 1);
            return;
          }
          setDisplayMonthIndex((prev) => prev + 1);
        }}
      />
      {pingSubscription ? (
        <PaymentPingPopup
          subscription={pingSubscription}
          onApproveByVoice={() => void startApproval(pingSubscription, "voice")}
          onApprove={() => void startApproval(pingSubscription, "button")}
          onSnooze={() => {
            setPingSubscriptionId(null);
            setStatusText("Ping snoozed.");
          }}
        />
      ) : null}
      {toastError ? (
        <div className="fixed right-4 top-4 z-50 max-w-sm rounded-sm border-2 border-black bg-stitch-card px-3 py-2 font-body text-xs font-semibold text-stitch-error shadow-[4px_4px_0_0_#000]">
          {toastError}
        </div>
      ) : null}
      {toastSuccess ? (
        <div className="fixed right-4 top-16 z-50 max-w-sm rounded-sm border-2 border-black bg-stitch-card px-3 py-2 font-body text-xs font-semibold text-stitch-success shadow-[4px_4px_0_0_#000]">
          {toastSuccess}
        </div>
      ) : null}
      </div>
    </div>
  );
}

function LeftRailAccountBlock({
  compact,
  email,
  pictureUrl,
  onOpenAccountSettings,
  onLogout,
}: {
  compact: boolean;
  email: string;
  pictureUrl: string | null;
  onOpenAccountSettings: () => void;
  onLogout: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const initial = email ? email[0]!.toUpperCase() : "?";

  useEffect(() => {
    if (!open) return;
    const updateMenuPosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const menuHeight = menuRef.current?.offsetHeight ?? 180;
      const preferredTop = rect.bottom - 8;
      const flippedTop = rect.top - menuHeight + 8;
      const top =
        preferredTop + menuHeight > window.innerHeight - 8
          ? Math.max(8, flippedTop)
          : Math.max(8, preferredTop);
      setMenuPos({
        top,
        left: Math.max(8, Math.min(rect.right + 12, window.innerWidth - 280)),
      });
    };
    updateMenuPosition();
    const raf = window.requestAnimationFrame(updateMenuPosition);
    const onDoc = (ev: MouseEvent) => {
      if (rootRef.current?.contains(ev.target as Node)) return;
      if (menuRef.current?.contains(ev.target as Node)) return;
      setOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setOpen(false);
    };
    const onViewport = () => updateMenuPosition();
    document.addEventListener("mousedown", onDoc, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onViewport);
    window.addEventListener("scroll", onViewport, true);
    return () => {
      window.cancelAnimationFrame(raf);
      document.removeEventListener("mousedown", onDoc, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onViewport);
      window.removeEventListener("scroll", onViewport, true);
    };
  }, [open]);

  async function handleLogout() {
    await onLogout();
    setOpen(false);
  }

  function handleAccountSettings() {
    onOpenAccountSettings();
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Account menu${email ? `, ${email}` : ""}`}
        className={
          compact
            ? "mx-auto flex h-10 w-10 items-center justify-center rounded-full border-2 border-black bg-stitch-elevated text-stitch-heading shadow-[2px_2px_0_0_#000] transition hover:bg-stitch-variant"
            : "flex w-full items-center gap-2 rounded-sm border-2 border-black bg-stitch-elevated p-2 text-left shadow-[2px_2px_0_0_#000] transition hover:bg-stitch-variant"
        }
      >
        {pictureUrl ? (
          <img
            src={pictureUrl}
            alt=""
            className={`shrink-0 rounded-full object-cover ring-1 ring-stitch-border/60 ${compact ? "h-8 w-8" : "h-9 w-9"}`}
          />
        ) : compact ? (
          <span className="font-body text-xs font-bold">{initial}</span>
        ) : (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-stitch-variant font-body text-xs font-bold text-stitch-heading">
            {initial}
          </div>
        )}
        {!compact ? (
          <div className="min-w-0 flex-1 text-left">
            <p className="font-body text-[10px] font-semibold uppercase tracking-wide text-stitch-muted">Account</p>
            <p className="truncate font-body text-xs font-semibold text-stitch-heading">{email || "Signed in"}</p>
          </div>
        ) : null}
      </button>

      {open
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={{ top: menuPos.top, left: menuPos.left }}
              className="fixed z-[120] w-[min(16rem,calc(100vw-1rem))]"
            >
              <div className="rounded-sm border-2 border-black bg-stitch-surface-low p-2 shadow-[6px_6px_0_0_var(--stitch-shadow-color)]">
                <p className="truncate px-2 py-1.5 font-body text-[11px] text-stitch-muted" title={email}>
                  {email}
                </p>
                <div className="my-1 border-t-2 border-black" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleAccountSettings}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left font-body text-xs font-semibold text-stitch-heading transition hover:bg-stitch-elevated"
                >
                  <span className="material-symbols-outlined text-[20px] leading-none" aria-hidden>
                    settings
                  </span>
                  Account Settings
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void handleLogout()}
                  className="mt-1 flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left font-body text-xs font-semibold text-stitch-heading transition hover:bg-red-950/50 hover:text-red-300"
                >
                  <span className="material-symbols-outlined text-[20px] leading-none" aria-hidden>
                    logout
                  </span>
                  Logout
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function LeftRail({
  activeView,
  compact,
  onToggleCompact,
  onCheckNow,
  onSelectUpcoming,
  onSelectHistory,
  onSelectSettings,
  onSelectHelp,
  accountEmail,
  accountPictureUrl,
  onOpenAccountSettings,
  onLogout,
  showAccountMenu,
}: {
  activeView: "upcoming" | "history" | "settings" | "help";
  compact: boolean;
  onToggleCompact: () => void;
  onCheckNow: () => void;
  onSelectUpcoming: () => void;
  onSelectHistory: () => void;
  onSelectSettings: () => void;
  onSelectHelp: () => void;
  accountEmail: string;
  accountPictureUrl: string | null;
  onOpenAccountSettings: () => void;
  onLogout: () => void | Promise<void>;
  showAccountMenu: boolean;
}) {
  return (
    <aside
      className={`order-2 flex min-h-0 min-w-0 flex-col overscroll-y-contain border-t-2 border-black bg-stitch-surface-lowest lg:relative lg:order-none lg:h-full lg:max-h-full lg:min-w-0 lg:overflow-x-hidden lg:overflow-y-visible lg:border-t-0 lg:border-r-2 lg:shadow-[4px_0_0_0_#000] ${
        compact ? "lg:px-2 lg:pt-3 lg:pb-4" : "lg:p-4 lg:pt-5"
      } overflow-x-hidden overflow-y-auto px-4 py-3`}
    >
      <div className="hidden lg:mb-2 lg:flex lg:justify-end">
        <button
          type="button"
          onClick={onToggleCompact}
          aria-label={compact ? "Expand sidebar" : "Collapse sidebar"}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border-2 border-black bg-stitch-elevated text-stitch-heading shadow-[2px_2px_0_0_#000] transition hover:bg-stitch-variant"
        >
          {compact ? <IconChevronRight /> : <IconChevronLeft />}
        </button>
      </div>
      <div className={`flex flex-col gap-1 ${compact ? "lg:items-center" : ""}`}>
        <p
          className={`font-display font-black italic tracking-tight text-stitch-primary-container ${compact ? "lg:text-base" : "text-xl"}`}
        >
          {STITCH_APP_NAME}
        </p>
        <p className={`font-display text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 ${compact ? "lg:sr-only" : ""}`}>
          Billing Â· identity Â· automation
        </p>
      </div>
      <div className="space-y-1.5 pt-3 pb-4">
        <button
          type="button"
          onClick={onCheckNow}
          title="Looks for pending subscriptions due within 24 hours. Opens the payment ping if one matches; otherwise updates the status line. A background check also runs about every 5 minutes and can show a desktop notification when allowed."
          aria-label="Check due payments now. Scans pending subscriptions due within 24 hours."
          className="noir-cmd-primary font-body w-full rounded py-3 text-sm"
        >
          <span className={compact ? "lg:hidden" : ""}>Check due payments now</span>
          <span className={compact ? "hidden lg:inline" : "hidden"}>+</span>
        </button>
        <p
          className={`font-body text-[10px] leading-snug text-zinc-500 ${compact ? "lg:sr-only" : ""}`}
        >
          Same scan as the automatic timer (~5 min). Timer can also send a desktop notification when permitted.
        </p>
      </div>
      <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto lg:min-h-0">
        <NavRow active={activeView === "upcoming"} compact={compact} icon={<NavMaterialIcon name="dashboard" />} label="Upcoming" onClick={onSelectUpcoming} />
        <NavRow active={activeView === "history"} compact={compact} icon={<NavMaterialIcon name="history" />} label="History" onClick={onSelectHistory} />
        <NavRow active={activeView === "settings"} compact={compact} icon={<NavMaterialIcon name="settings" />} label="Settings" onClick={onSelectSettings} />
        <NavRow active={activeView === "help"} compact={compact} icon={<NavMaterialIcon name="help" />} label="Help" onClick={onSelectHelp} />
      </nav>

      {showAccountMenu ? (
        <div className="mt-auto shrink-0 border-t-2 border-black pt-3">
          <LeftRailAccountBlock
            compact={compact}
            email={accountEmail}
            pictureUrl={accountPictureUrl}
            onOpenAccountSettings={onOpenAccountSettings}
            onLogout={onLogout}
          />
        </div>
      ) : null}
    </aside>
  );
}

function NavRow({
  label,
  icon,
  active,
  compact,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  compact?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "flex items-center gap-3 rounded-sm border-2 border-black bg-stitch-primary-container py-2.5 pl-2.5 pr-3 font-display text-sm font-bold tracking-tight text-stitch-on-primary-fixed shadow-[2px_2px_0_0_#000] translate-x-px"
          : "flex items-center gap-3 rounded-sm py-2.5 pl-2.5 pr-3 font-display text-sm font-bold tracking-tight text-zinc-500 transition duration-150 hover:translate-x-px hover:bg-zinc-900 hover:text-stitch-primary-container"
      }
    >
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center ${active ? "text-stitch-on-primary-fixed" : "text-current"}`}>{icon}</span>
      <span className={compact ? "lg:sr-only" : ""}>{label}</span>
    </button>
  );
}

function CenterPane({
  view,
  subscriptions,
  subscriptionsLoading,
  subscriptionsMutating,
  history,
  settings,
  statusText,
  pendingApproval,
  faceMfaOpen,
  onCancelFaceMfa,
  onFacePurchaseVerified,
  onApprove,
  onDeleteSubscription,
  onAddSubscription,
  googleSignedIn,
  onToggleSetting,
  authEmailDraft,
  onAuthEmailDraftChange,
  onAuthEmailCommit,
  accountDisplayEmail,
  onGoogleLinkedEmail,
  onAuthSessionChange,
  onGmailImportSuccess,
  onGmailImportError,
  onSubscriptionsRefresh,
  confettiTrigger,
  gamifyRefreshTick,
  onRequestGoogleConnect,
  settingsAccountTabSignal,
  settingsBillingTabSignal,
  settingsVoiceTabSignal,
  settingsAlertsTabSignal,
  settingsFaceTabSignal,
  settingsAppearanceTabSignal,
  ragVoiceRun,
  gmailDiscoverSignal,
}: {
  view: "upcoming" | "history" | "settings" | "help";
  subscriptions: SubscriptionItem[];
  subscriptionsLoading: boolean;
  subscriptionsMutating: boolean;
  history: PaymentRecord[];
  settings: VoiceFaceSettings;
  statusText: string;
  pendingApproval: SubscriptionItem | null;
  faceMfaOpen: boolean;
  onCancelFaceMfa: () => void;
  onFacePurchaseVerified: () => void;
  onApprove: (subscription: SubscriptionItem) => void;
  onDeleteSubscription: (id: string) => void;
  onAddSubscription: (item: SubscriptionItem) => void;
  googleSignedIn: boolean;
  onToggleSetting: <K extends keyof VoiceFaceSettings>(key: K, value: VoiceFaceSettings[K]) => void;
  authEmailDraft: string;
  onAuthEmailDraftChange: (email: string) => void;
  onAuthEmailCommit: () => void;
  /** Google session email or committed demo email â€” used for face MFA + welcome (not the live draft field). */
  accountDisplayEmail: string;
  onGoogleLinkedEmail: (email: string) => void;
  onAuthSessionChange: () => void;
  onGmailImportSuccess: (message: string) => void;
  onGmailImportError: (message: string) => void;
  onSubscriptionsRefresh: () => void;
  confettiTrigger: number;
  gamifyRefreshTick: number;
  onRequestGoogleConnect: () => void;
  settingsAccountTabSignal: number;
  settingsBillingTabSignal: number;
  settingsVoiceTabSignal: number;
  settingsAlertsTabSignal: number;
  settingsFaceTabSignal: number;
  settingsAppearanceTabSignal: number;
  ragVoiceRun: { id: number; query: string } | null;
  gmailDiscoverSignal: number;
}) {
  if (view === "upcoming") {
    return (
      <main className="order-1 flex min-h-0 min-w-0 w-full flex-1 flex-col bg-transparent lg:order-none lg:h-full">
        {faceMfaOpen && pendingApproval ? (
          <div className="shrink-0 border-b-2 border-black bg-stitch-card px-4 py-3 lg:px-5">
            <FaceVerificationPanel
              purpose="purchase"
              purchaseSubtitle={`${pendingApproval.name} Â· $${pendingApproval.amountUsd.toFixed(2)}`}
              initialEmail={accountDisplayEmail}
              onPurchaseVerified={onFacePurchaseVerified}
              onPurchaseCancel={onCancelFaceMfa}
            />
          </div>
        ) : null}
        <Dashboard
          googleSignedIn={googleSignedIn}
          authEmailCommitted={accountDisplayEmail}
          history={history}
          subscriptions={subscriptions}
          subscriptionsLoading={subscriptionsLoading}
          subscriptionsMutating={subscriptionsMutating}
          confettiTrigger={confettiTrigger}
          gamifyRefreshTick={gamifyRefreshTick}
          onApprove={onApprove}
          onDelete={onDeleteSubscription}
          onAdd={onAddSubscription}
          onGmailImportSuccess={onGmailImportSuccess}
          onGmailImportError={onGmailImportError}
          onSubscriptionsRefresh={onSubscriptionsRefresh}
          onRequestGoogleConnect={onRequestGoogleConnect}
          gmailDiscoverSignal={gmailDiscoverSignal}
        />
      </main>
    );
  }

  if (view === "help") {
    return (
      <main className="order-1 flex min-h-0 min-w-0 w-full flex-1 flex-col bg-transparent lg:order-none lg:h-full">
        <header className="flex shrink-0 flex-col gap-2 border-b-2 border-black bg-stitch-topbar px-4 py-3 shadow-[0_4px_0_0_#000] lg:px-5">
          <h1 className="font-display text-lg font-bold uppercase tracking-tighter text-stitch-heading">Help & support</h1>
          <p className="font-body text-xs text-stitch-text">{statusText}</p>
        </header>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-4 lg:px-5">
          <StitchHelpView />
        </div>
      </main>
    );
  }

  return (
    <main className="order-1 flex min-h-0 min-w-0 w-full flex-1 flex-col bg-transparent lg:order-none lg:h-full">
      <header className="flex shrink-0 flex-col gap-2 border-b-2 border-black bg-stitch-topbar px-4 py-3 shadow-[0_4px_0_0_#000] lg:px-5">
        <h1 className="font-display text-lg font-bold uppercase tracking-tighter text-stitch-heading">
          {view === "history" ? "Payment history" : "Settings"}
        </h1>
        <p className="font-body text-xs text-stitch-text">{statusText}</p>
      </header>
      <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 lg:px-5">
        {faceMfaOpen && pendingApproval ? (
          <FaceVerificationPanel
            purpose="purchase"
            purchaseSubtitle={`${pendingApproval.name} Â· $${pendingApproval.amountUsd.toFixed(2)}`}
            initialEmail={accountDisplayEmail}
            onPurchaseVerified={onFacePurchaseVerified}
            onPurchaseCancel={onCancelFaceMfa}
          />
        ) : null}
        {view === "history" ? <PaymentHistory records={history} /> : null}
        {view === "settings" ? (
          <GamifiedSettingsView
            settings={settings}
            onToggleSetting={onToggleSetting}
            accountEmailDraft={authEmailDraft}
            onAccountEmailDraftChange={onAuthEmailDraftChange}
            onAccountEmailCommit={onAuthEmailCommit}
            faceEnrollmentEmail={accountDisplayEmail}
            onGoogleLinkedEmail={onGoogleLinkedEmail}
            onAuthSessionChange={onAuthSessionChange}
            openAccountTabSignal={settingsAccountTabSignal}
            openBillingTabSignal={settingsBillingTabSignal}
            openVoiceTabSignal={settingsVoiceTabSignal}
            openAlertsTabSignal={settingsAlertsTabSignal}
            openFaceTabSignal={settingsFaceTabSignal}
            openAppearanceTabSignal={settingsAppearanceTabSignal}
            ragVoiceRunRequest={ragVoiceRun}
          />
        ) : null}
      </div>
    </main>
  );
}

function PaymentHistory({ records }: { records: PaymentRecord[] }) {
  const monthlyTotal = records.reduce((sum, item) => sum + item.amountUsd, 0);
  return (
    <section className="noir-card p-4 md:p-5">
      <div className="ink-line flex flex-wrap items-center justify-between gap-2 pb-4">
        <p className="font-display text-lg font-bold uppercase tracking-tight text-stitch-heading">Payment history</p>
        <span className="font-mono text-sm font-bold text-stitch-success">Î£ ${monthlyTotal.toFixed(2)}</span>
      </div>
      {records.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-stitch-border bg-stitch-surface/80 p-6 text-center font-body text-sm text-stitch-text">
          No approved payments yet. Approve a renewal from Upcoming to see it here.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {records.map((record) => (
            <li key={record.id} className="noir-card-sm p-3">
              <p className="font-body text-sm font-semibold text-stitch-heading">
                {record.subscriptionName} Â· <span className="font-mono text-stitch-success">${record.amountUsd.toFixed(2)}</span>
              </p>
              <p className="font-body text-xs text-stitch-muted">
                {formatDateTime(record.approvedAtIso)} Â· {record.method}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PaymentPingPopup({
  subscription,
  onApproveByVoice,
  onApprove,
  onSnooze,
}: {
  subscription: SubscriptionItem;
  onApproveByVoice: () => void;
  onApprove: () => void;
  onSnooze: () => void;
}) {
  return (
    <div className="fixed right-4 bottom-24 z-40 w-[min(92vw,26rem)] rounded-sm border-2 border-black bg-stitch-surface-low p-4 shadow-[4px_4px_0_0_#000]">
      <p className="font-display text-sm font-bold text-stitch-heading">Payment due: {subscription.name}</p>
      <p className="mt-1 font-mono text-xs text-stitch-error">
        ${subscription.amountUsd.toFixed(2)} due {formatDate(subscription.dueDateIso)}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onApproveByVoice}
          className="rounded-sm border-2 border-black bg-stitch-elevated px-3 py-1.5 font-body text-xs font-semibold text-stitch-heading shadow-[2px_2px_0_0_#000] hover:bg-stitch-variant"
        >
          Approve by voice
        </button>
        <button type="button" onClick={onApprove} className="noir-cmd-primary rounded-sm px-3 py-1.5 font-body text-xs">
          Approve
        </button>
        <button
          type="button"
          onClick={onSnooze}
          className="rounded-sm border-2 border-black bg-transparent px-3 py-1.5 font-body text-xs font-semibold text-zinc-500 hover:text-stitch-heading"
        >
          Snooze
        </button>
      </div>
    </div>
  );
}

function RightRail({
  subscriptions,
  displayYear,
  displayMonthIndex,
  voiceActivation,
  onVoiceActivationChange,
  voicePillActive,
  voicePillListening,
  voicePillSpeechEcho,
  voicePillEchoSource,
  voicePillSpeechError,
  voicePillBridgePhase,
  voicePillBridgeMicLevel,
  voicePillBridgeEngine,
  voicePillInputDeviceId,
  onVoicePillInputDeviceIdChange,
  voicePillPendingLabel,
  onVoicePillApproveByVoice,
  onPrevMonth,
  onNextMonth,
}: {
  subscriptions: SubscriptionItem[];
  displayYear: number;
  displayMonthIndex: number;
  voiceActivation: boolean;
  onVoiceActivationChange: (next: boolean) => void;
  voicePillActive: boolean;
  voicePillListening: boolean;
  voicePillSpeechEcho: string;
  voicePillEchoSource: "web" | "bridge" | "none";
  voicePillSpeechError: string | null;
  voicePillBridgePhase: BridgeVoicePhase | null;
  voicePillBridgeMicLevel: number;
  voicePillBridgeEngine: string | null;
  voicePillInputDeviceId: string;
  onVoicePillInputDeviceIdChange: (deviceId: string) => void;
  voicePillPendingLabel: string | null;
  onVoicePillApproveByVoice: () => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}) {
  const month = getMonthLabel(displayYear, displayMonthIndex);
  const calendarCells = buildCalendarGrid(displayYear, displayMonthIndex);
  const dueDates = new Set(subscriptions.map((item) => item.dueDateIso));
  return (
    <aside className="order-3 flex min-h-0 min-w-0 w-full flex-col overflow-x-hidden border-t-2 border-black bg-stitch-surface-lowest lg:h-full lg:max-h-full lg:border-t-0 lg:border-l-2 lg:shadow-[-4px_0_0_0_#000] lg:p-4 lg:pt-5">
      <p className="font-display px-4 pt-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-stitch-muted lg:px-0 lg:pt-0">
        Renewal calendar
      </p>
      <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 lg:px-0">
        <div className="noir-card p-4">
          <div className="mt-1 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={onPrevMonth}
              className="flex h-7 w-7 items-center justify-center rounded-sm border-2 border-black bg-stitch-elevated text-sm font-semibold text-stitch-heading shadow-[2px_2px_0_0_#000] hover:bg-stitch-variant"
            >
              {"<"}
            </button>
            <p className="font-display text-sm font-bold text-stitch-heading">{month.label}</p>
            <button
              type="button"
              onClick={onNextMonth}
              className="flex h-7 w-7 items-center justify-center rounded-sm border-2 border-black bg-stitch-elevated text-sm font-semibold text-stitch-heading shadow-[2px_2px_0_0_#000] hover:bg-stitch-variant"
            >
              {">"}
            </button>
          </div>
          <div className="mt-2 grid grid-cols-7 gap-1">
            {["M", "T", "W", "T", "F", "S", "S"].map((day, dowIdx) => (
              <span key={`cal-dow-${dowIdx}`} className="text-center font-body text-[10px] font-semibold text-stitch-muted">
                {day}
              </span>
            ))}
            {calendarCells.map((cell, index) => (
              <span
                key={`${cell.iso ?? "empty"}-${index}`}
                className={
                  cell.iso == null
                    ? "h-7"
                    : `flex h-7 items-center justify-center rounded text-xs font-body ${
                        dueDates.has(cell.iso)
                          ? "border-2 border-black bg-stitch-primary-container font-semibold text-stitch-on-primary-fixed shadow-[2px_2px_0_0_#000]"
                          : "bg-stitch-elevated/90 text-stitch-text"
                      }`
                }
              >
                {cell.day ?? ""}
              </span>
            ))}
          </div>
          <p className="mt-2 font-body text-xs text-stitch-muted">Highlighted dates have renewals due.</p>
        </div>
        <div className="space-y-2">
          <p className="font-display px-0.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-stitch-muted">
            Listening &amp; response
          </p>
          <VoiceQuestPill
            layout="rail"
            active={voicePillActive}
            listening={voicePillListening}
            speechEcho={voicePillSpeechEcho}
            echoSource={voicePillEchoSource}
            speechError={voicePillSpeechError}
            bridgePhase={voicePillBridgePhase}
            bridgeMicLevel={voicePillBridgeMicLevel}
            bridgeEngine={voicePillBridgeEngine}
            voiceInputDeviceId={voicePillInputDeviceId}
            onVoiceInputDeviceIdChange={onVoicePillInputDeviceIdChange}
            pendingLabel={voicePillPendingLabel}
            onApproveByVoice={onVoicePillApproveByVoice}
            hintsOn={voicePillActive}
          />
        </div>
        <div className="noir-card p-4">
          <p className="font-display text-[11px] font-semibold uppercase tracking-[0.2em] text-stitch-muted">Voice activation</p>
          <p className="mt-1 font-body text-[11px] leading-snug text-stitch-muted">
            Hands-free listening for short commands (for example &quot;open settings&quot;, &quot;approve&quot;). Speech engine and mic
            device live under Settings â†’ Voice.
          </p>
          <div className="mt-3">
            <SettingsToggleRow
              label="Always listening"
              checked={voiceActivation}
              onToggle={onVoiceActivationChange}
            />
          </div>
        </div>
      </div>
    </aside>
  );
}

function getMonthLabel(year: number, monthIndex: number) {
  const source = new Date(year, monthIndex, 1);
  return { year, monthIndex, label: source.toLocaleString(undefined, { month: "long", year: "numeric" }) };
}

function buildCalendarGrid(year: number, monthIndex: number) {
  const first = new Date(year, monthIndex, 1);
  const lead = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells: Array<{ day?: number; iso?: string }> = [];
  for (let i = 0; i < lead; i += 1) cells.push({});
  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push({ day, iso });
  }
  return cells;
}

function formatDate(iso: string) {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDateTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function NavMaterialIcon({ name }: { name: "dashboard" | "history" | "settings" | "help" }) {
  return (
    <span className="material-symbols-outlined text-[22px] leading-none" aria-hidden>
      {name}
    </span>
  );
}

function IconChevronLeft() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
      <path d="M14 6l-6 6 6 6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconChevronRight() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
      <path d="M10 6l6 6-6 6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
