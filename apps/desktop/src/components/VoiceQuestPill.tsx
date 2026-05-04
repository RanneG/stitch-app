/**
 * Voice status / bridge STT UI — floating bar (legacy) or embedded in the right rail below the calendar.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { formatMediaDeviceLabel } from "../lib/voiceInputDevice";
import type { BridgeVoicePhase } from "./bridgeVoiceStt";

export type VoiceQuestPillLayout = "floating" | "rail";

export type VoiceQuestPillProps = {
  layout?: VoiceQuestPillLayout;
  active: boolean;
  listening: boolean;
  speechEcho?: string;
  echoSource?: "web" | "bridge" | "none";
  speechError?: string | null;
  bridgePhase?: BridgeVoicePhase | null;
  bridgeMicLevel?: number;
  bridgeEngine?: string | null;
  voiceInputDeviceId: string;
  onVoiceInputDeviceIdChange: (deviceId: string) => void;
  pendingLabel?: string | null;
  onApproveByVoice: () => void;
  hintsOn?: boolean;
};

function VoiceBridgeInputDevicePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (deviceId: string) => void;
}) {
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const relist = useCallback(async (requestPermission: boolean) => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setNote("This host does not support listing microphones.");
      return;
    }
    if (requestPermission) {
      setBusy(true);
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop());
        setNote(null);
      } catch {
        setNote("Allow the microphone once to show friendly device names.");
      } finally {
        setBusy(false);
      }
    }
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setInputs(list.filter((d) => d.kind === "audioinput"));
    } catch {
      setNote("Could not list audio inputs.");
    }
  }, []);

  useEffect(() => {
    void relist(false);
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    const onDeviceChange = () => void relist(false);
    md.addEventListener("devicechange", onDeviceChange);
    return () => md.removeEventListener("devicechange", onDeviceChange);
  }, [relist]);

  const selectValue = value && inputs.some((d) => d.deviceId === value) ? value : "";

  return (
    <div className="mt-2 space-y-1.5 rounded border border-stitch-border/50 bg-black/20 px-2 py-1.5">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <span className="font-body text-[9px] font-semibold uppercase tracking-wide text-stitch-muted">Microphone</span>
        <button
          type="button"
          className="rounded border border-stitch-border bg-stitch-card px-1.5 py-0.5 font-body text-[9px] text-stitch-heading hover:bg-stitch-variant disabled:opacity-40"
          disabled={busy}
          onClick={() => void relist(true)}
        >
          {busy ? "…" : "Refresh list"}
        </button>
      </div>
      <select
        className="w-full max-w-full cursor-pointer truncate rounded border border-stitch-border bg-stitch-card px-2 py-1 font-body text-[10px] text-stitch-heading"
        value={selectValue}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">System default</option>
        {inputs.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {formatMediaDeviceLabel(d)}
          </option>
        ))}
      </select>
      {note ? <p className="font-body text-[9px] text-stitch-muted">{note}</p> : null}
    </div>
  );
}

function bridgePhaseDetail(phase: BridgeVoicePhase | null | undefined, engine: string | null | undefined): string {
  if (!phase) return "Connecting to the microphone…";
  const eng = (engine || "").toLowerCase();
  const whisperNote =
    eng === "whisper"
      ? " First Whisper load on CPU often takes 1–3 minutes — watch the Python/bridge terminal for download or compile progress."
      : "";
  switch (phase) {
    case "init":
      return "Requesting microphone access…";
    case "mic_ready":
      return "Audio capture is running. The meter below should move when you speak.";
    case "awaiting_speech":
      return `Waiting for speech above the silence floor — speak, then pause ~0.7s to send a clip to the bridge.${whisperNote}`;
    case "capturing_speech":
      return "Hearing speech — when you are done, pause briefly so the clip can be packaged and sent.";
    case "sending_to_server":
      return `Uploading audio to the bridge and waiting for a transcript…${whisperNote}`;
    default:
      return "Working…";
  }
}

export function VoiceQuestPill({
  layout = "floating",
  active,
  listening,
  speechEcho,
  echoSource,
  speechError,
  bridgePhase,
  bridgeMicLevel,
  bridgeEngine,
  voiceInputDeviceId,
  onVoiceInputDeviceIdChange,
  pendingLabel,
  onApproveByVoice,
  hintsOn,
}: VoiceQuestPillProps) {
  const [open, setOpen] = useState(layout === "rail");
  const echo = speechEcho?.trim() ?? "";
  const expanded = open || listening || Boolean(pendingLabel || echo || speechError);
  const micLevel = Math.max(0, Math.min(1, bridgeMicLevel ?? 0));
  const lastLoudAtRef = useRef<number>(Date.now());
  useEffect(() => {
    if (!listening) {
      lastLoudAtRef.current = Date.now();
      return;
    }
    if (echoSource !== "bridge") return;
    if (micLevel > 0.07) lastLoudAtRef.current = Date.now();
  }, [echoSource, listening, micLevel]);
  const [quietHint, setQuietHint] = useState(false);
  useEffect(() => {
    if (echoSource !== "bridge" || !listening || bridgePhase === "sending_to_server") {
      setQuietHint(false);
      return;
    }
    const tick = () => {
      const idle = bridgePhase === "awaiting_speech" || bridgePhase === "mic_ready";
      if (idle && Date.now() - lastLoudAtRef.current > 8000 && micLevel < 0.06) setQuietHint(true);
      else if (micLevel > 0.07) setQuietHint(false);
    };
    tick();
    const id = window.setInterval(tick, 1200);
    return () => window.clearInterval(id);
  }, [echoSource, listening, bridgePhase, micLevel]);

  const body = (
    <>
      <p className="font-body text-xs font-semibold text-stitch-heading">{listening ? "Listening…" : "Voice ready"}</p>
      {expanded ? (
        <div className="min-w-0 font-body text-[10px] text-stitch-muted">
          {speechError ? <p className="text-stitch-error">{speechError}</p> : null}
          {pendingLabel ? (
            <p className="truncate">Say “approve” for {pendingLabel}</p>
          ) : active ? (
            <>
              <p className="truncate">Say “approve” when a payment is pending.</p>
              {hintsOn ? (
                <div className="mt-1 rounded border border-stitch-border/60 bg-black/30 px-2 py-1.5">
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-stitch-muted">
                    {echoSource === "bridge" ? "Local STT (bridge)" : echoSource === "web" ? "Web Speech" : "Voice output"}
                  </p>
                  {echoSource === "bridge" && bridgeEngine ? (
                    <p className="mt-0.5 font-mono text-[10px] text-stitch-text">
                      Bridge engine: <span className="text-stitch-heading">{bridgeEngine}</span>
                    </p>
                  ) : null}
                  {echoSource === "bridge" ? (
                    <VoiceBridgeInputDevicePicker value={voiceInputDeviceId} onChange={onVoiceInputDeviceIdChange} />
                  ) : null}
                  {echoSource === "bridge" && listening ? (
                    <div className="mt-1.5 space-y-0.5" aria-hidden>
                      <div className="flex items-center justify-between gap-2 font-mono text-[9px] text-stitch-muted">
                        <span>Input level</span>
                        <span>{(micLevel * 100).toFixed(0)}%</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded bg-black/50" title="Live microphone level (bridge path)">
                        <div
                          className="h-full rounded bg-stitch-primary-container transition-[width] duration-75"
                          style={{ width: `${Math.min(100, micLevel * 100)}%` }}
                        />
                      </div>
                    </div>
                  ) : null}
                  {echo ? (
                    <p
                      className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-snug text-stitch-heading"
                      title={echo}
                      aria-live="polite"
                    >
                      {echo}
                    </p>
                  ) : listening ? (
                    <div className="mt-1 space-y-1" aria-live="polite">
                      {echoSource === "bridge" ? (
                        <>
                          <p className="font-mono text-[10px] font-semibold uppercase tracking-wide text-stitch-muted">
                            {bridgePhase === "sending_to_server"
                              ? "Transcribing on server"
                              : bridgePhase === "capturing_speech"
                                ? "Recording utterance"
                                : bridgePhase === "mic_ready" || bridgePhase === "awaiting_speech"
                                  ? "Ready — waiting for speech"
                                  : bridgePhase === "init"
                                    ? "Starting mic"
                                    : "Bridge status"}
                          </p>
                          <p className="leading-snug text-stitch-muted">{bridgePhaseDetail(bridgePhase, bridgeEngine)}</p>
                          {quietHint ? (
                            <p className="rounded border border-stitch-error/40 bg-stitch-error/10 px-1.5 py-1 text-[10px] leading-snug text-stitch-error">
                              No strong mic signal detected for several seconds. Check Windows privacy → Microphone for this app, default
                              input device, and try speaking closer. The level bar should move when sound reaches the app.
                            </p>
                          ) : null}
                        </>
                      ) : (
                        <p className="font-mono text-[11px] text-stitch-heading">… waiting for transcript</p>
                      )}
                      {echoSource === "bridge" ? (
                        <p className="leading-snug text-stitch-muted">
                          Live status lines appear as <span className="font-mono text-stitch-text">[bridge] …</span> when the server
                          returns text or errors.
                        </p>
                      ) : (
                        <p className="leading-snug text-stitch-muted">
                          Web Speech is idle. If this stays empty in the desktop window, set Settings → Voice → Speech engine to{" "}
                          <strong className="text-stitch-text">Auto</strong> (with stitch_rag_bridge.py running) or{" "}
                          <strong className="text-stitch-text">Local bridge</strong>. You can also open{" "}
                          <span className="break-all font-mono text-[10px] text-stitch-text">
                            {typeof window !== "undefined"
                              ? window.location.origin || window.location.href || "(this window’s URL)"
                              : ""}
                          </span>{" "}
                          in a normal browser tab.
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="mt-1 font-mono text-[11px] text-stitch-muted">—</p>
                  )}
                </div>
              ) : null}
              {hintsOn ? (
                <p className="mt-1 leading-snug">
                  Navigate: “open voice”, “open face”, “open alerts”, “open account”, “open billing”, “open document brain”, “open
                  settings”. Theme: “switch to dark mode”, “toggle theme”. Pay: “pay for Netflix”, “demo pay Spotify”. Gmail: “scan Gmail”.
                  Docs: “ask my documents about …”.
                </p>
              ) : null}
            </>
          ) : (
            <p className="truncate">Enable voice in Settings → Voice.</p>
          )}
        </div>
      ) : null}
    </>
  );

  const actions = (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded border border-stitch-border bg-stitch-tertiary px-2 py-1 font-body text-[10px] font-semibold text-stitch-heading hover:bg-[#2a2c32]"
        aria-expanded={expanded}
      >
        {expanded ? "Less" : "More"}
      </button>
      {pendingLabel ? (
        <button type="button" onClick={onApproveByVoice} className="noir-cmd-primary rounded px-3 py-1.5 font-body text-[10px]">
          Approve
        </button>
      ) : null}
    </>
  );

  if (layout === "rail") {
    return (
      <div className="w-full" role="region" aria-label="Voice assistant">
        <div className="flex w-full flex-col gap-2 rounded-lg border border-stitch-border bg-[#1a1c20] p-3 shadow-[3px_3px_0_0_#000]">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-start gap-2">
              <span className="text-lg shrink-0" aria-hidden>
                🎤
              </span>
              <div className="min-w-0 flex-1">{body}</div>
            </div>
            <div className="flex shrink-0 flex-row flex-wrap items-start justify-end gap-1">{actions}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-40 -translate-x-1/2 px-4">
      <div
        className={`pointer-events-auto flex max-w-lg items-center gap-3 rounded-lg border border-stitch-border bg-[#1a1c20] px-4 py-2 shadow-[3px_3px_0_0_#000] transition-all duration-300 ${
          expanded ? "pr-2" : ""
        }`}
        role="region"
        aria-label="Voice assistant"
      >
        <span className="text-lg" aria-hidden>
          🎤
        </span>
        <div className="min-w-0 flex-1">{body}</div>
        <div className="flex shrink-0 flex-row flex-wrap items-center justify-end gap-1">{actions}</div>
      </div>
    </div>
  );
}
