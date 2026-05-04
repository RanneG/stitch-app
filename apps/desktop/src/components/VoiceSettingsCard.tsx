import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceFaceSettings, VoiceSttBackend } from "../fixtures/subscriptions";
import {
  formatMediaDeviceLabel,
  readStitchVoiceInputDeviceId,
  STITCH_VOICE_INPUT_DEVICE_CHANGED,
  writeStitchVoiceInputDeviceId,
} from "../lib/voiceInputDevice";
import { describeStitchVoiceCommand, matchStitchVoiceCommand } from "./voiceCommands";
import { SettingsToggleRow } from "./SettingsToggleRow";

const METER_BAR_COUNT = 20;
/** Larger window = smoother RMS for speech; must be power of 2 for analyser. */
const METER_FFT_SIZE = 2048;

function makeIdleMeterBars(): number[] {
  return Array.from({ length: METER_BAR_COUNT }, () => 0.04);
}

const LS_VOICE_OUTPUT = "stitch.voiceOutputDeviceId";

function readVoiceDeviceLs(key: string): string {
  try {
    const v = localStorage.getItem(key);
    return v && v.trim() ? v.trim() : "";
  } catch {
    return "";
  }
}

function writeVoiceDeviceLs(key: string, value: string): void {
  try {
    if (value.trim()) localStorage.setItem(key, value.trim());
    else localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

type AudioContextWithSink = AudioContext & { setSinkId?: (sinkId: string) => Promise<void> };

function setVoiceTestExclusive(on: boolean): void {
  try {
    (window as Window & { __STITCH_VOICE_TEST_ACTIVE?: boolean }).__STITCH_VOICE_TEST_ACTIVE = on;
  } catch {
    /* ignore */
  }
}

/** Voice activation + one-shot Web Speech test — Settings → Voice. */
export function VoiceSettingsCard({
  settings,
  onToggleSetting,
}: {
  settings: VoiceFaceSettings;
  onToggleSetting: <K extends keyof VoiceFaceSettings>(key: K, value: VoiceFaceSettings[K]) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-stitch-border bg-stitch-surface/50 p-3 font-body text-[11px] leading-relaxed text-stitch-text">
        <p>
          <strong className="text-stitch-heading">Hands-free mode</strong> listens in the background for short phrases (for example
          &quot;open settings&quot; or &quot;scan Gmail&quot;) so you can drive Stitch without clicking.
        </p>
        <p className="mt-2 text-stitch-muted">
          The <strong className="text-stitch-heading">test</strong> below records one phrase and shows what Stitch understood — useful
          to check your mic and phrasing.
        </p>
      </div>
      <SettingsToggleRow
        label="Voice activation (always listening)"
        checked={settings.voiceActivation}
        onToggle={(next) => onToggleSetting("voiceActivation", next)}
      />
      <label className="flex flex-col gap-1 rounded-lg border border-stitch-border bg-stitch-surface/50 p-3 font-body text-[11px] text-stitch-text">
        <span className="font-semibold text-stitch-heading">Speech engine</span>
        <span className="text-stitch-muted">
          <strong className="text-stitch-heading">Auto</strong> uses the local bridge when <code className="text-stitch-text">/api/health</code>{" "}
          reports voice STT (best for desktop). <strong className="text-stitch-heading">Browser</strong> uses Chromium Web Speech only.
        </span>
        <select
          className="mt-1 rounded border border-stitch-border bg-stitch-card px-2 py-1.5 font-body text-xs text-stitch-heading"
          value={settings.voiceSttBackend}
          onChange={(ev) => onToggleSetting("voiceSttBackend", ev.target.value as VoiceSttBackend)}
        >
          <option value="auto">Auto — bridge when available, else Web Speech</option>
          <option value="bridge">Local bridge only (mic → stitch_rag_bridge)</option>
          <option value="web_speech">Browser Web Speech only</option>
        </select>
      </label>
      <VoiceRecognitionTestSection voiceActivationOn={settings.voiceActivation} />
    </div>
  );
}

/** Teams-style mic activity: vertical bars driven by Web Audio (independent of Web Speech). */
function MicLevelMeter({ levels }: { levels: number[] }) {
  const bars = levels.length === METER_BAR_COUNT ? levels : makeIdleMeterBars();
  return (
    <div
      className="flex h-12 w-full gap-0.5 rounded border border-stitch-border/70 bg-stitch-surface-low/90 px-1.5 py-1"
      aria-hidden
    >
      {bars.map((h, i) => {
        const pct = Math.round(Math.min(1, Math.max(0, h)) * 100);
        return (
          <div key={i} className="flex h-full min-w-0 flex-1 flex-col justify-end">
            <div
              className="w-full min-h-[2px] rounded-sm bg-gradient-to-t from-stitch-primary/35 to-stitch-primary shadow-[0_0_6px_rgba(34,211,238,0.25)]"
              style={{ height: `${Math.max(4, pct)}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}

function VoiceRecognitionTestSection({ voiceActivationOn }: { voiceActivationOn: boolean }) {
  const [supported, setSupported] = useState(false);
  const [running, setRunning] = useState(false);
  const [arming, setArming] = useState(false);
  const [meterBars, setMeterBars] = useState<number[]>(() => makeIdleMeterBars());
  const [meterUnavailable, setMeterUnavailable] = useState(false);
  const [liveLine, setLiveLine] = useState<string | null>(null);
  const [lastFinal, setLastFinal] = useState("");
  const [interpreted, setInterpreted] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const meterRafRef = useRef<number | null>(null);
  const meterAudioRef = useRef<{
    ctx: AudioContext;
    analyser: AnalyserNode;
    stream: MediaStream;
    timeDomain: Float32Array;
    smoothed: number[];
  } | null>(null);

  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [micDeviceId, setMicDeviceId] = useState(() => readStitchVoiceInputDeviceId());
  const [outputDeviceId, setOutputDeviceId] = useState(() => readVoiceDeviceLs(LS_VOICE_OUTPUT));
  const [deviceListBusy, setDeviceListBusy] = useState(false);
  const [deviceListNote, setDeviceListNote] = useState<string | null>(null);
  const [outputSinkWarning, setOutputSinkWarning] = useState<string | null>(null);

  const relistAudioDevices = useCallback(async (requestMicPermission: boolean) => {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== "function") {
      setDeviceListNote("This browser does not expose device lists.");
      return;
    }
    if (!requestMicPermission) setDeviceListNote(null);
    if (requestMicPermission) {
      setDeviceListBusy(true);
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop());
        setDeviceListNote(null);
      } catch {
        setDeviceListNote("Allow the microphone once to load friendly device names.");
      } finally {
        setDeviceListBusy(false);
      }
    }
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setAudioInputs(list.filter((d) => d.kind === "audioinput"));
      setAudioOutputs(list.filter((d) => d.kind === "audiooutput"));
    } catch {
      setDeviceListNote("Could not enumerate audio devices.");
    }
  }, []);

  useEffect(() => {
    void relistAudioDevices(false);
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    const onChange = () => void relistAudioDevices(false);
    md.addEventListener("devicechange", onChange);
    return () => md.removeEventListener("devicechange", onChange);
  }, [relistAudioDevices]);

  useEffect(() => {
    const syncMic = () => setMicDeviceId(readStitchVoiceInputDeviceId());
    window.addEventListener(STITCH_VOICE_INPUT_DEVICE_CHANGED, syncMic as EventListener);
    return () => window.removeEventListener(STITCH_VOICE_INPUT_DEVICE_CHANGED, syncMic as EventListener);
  }, []);

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  const stopMicMeter = useCallback(() => {
    if (meterRafRef.current != null) {
      window.cancelAnimationFrame(meterRafRef.current);
      meterRafRef.current = null;
    }
    const m = meterAudioRef.current;
    meterAudioRef.current = null;
    if (!m) return;
    try {
      m.stream.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }
    try {
      void m.ctx.close();
    } catch {
      /* ignore */
    }
    setMeterBars(makeIdleMeterBars());
  }, []);

  useEffect(() => {
    const w = window as Window & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    setSupported(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  useEffect(
    () => () => {
      cancelledRef.current = true;
      clearWatchdog();
      stopMicMeter();
      try {
        recognitionRef.current?.stop();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
      setVoiceTestExclusive(false);
    },
    [clearWatchdog, stopMicMeter],
  );

  const stopTest = useCallback(() => {
    cancelledRef.current = true;
    clearWatchdog();
    stopMicMeter();
    const rec = recognitionRef.current;
    try {
      rec?.stop();
    } catch {
      /* ignore */
    }
    recognitionRef.current = null;
    setRunning(false);
    setArming(false);
    setLiveLine(null);
    if (!rec) {
      setVoiceTestExclusive(false);
      window.dispatchEvent(new Event("stitch-voice-test-finished"));
    }
  }, [clearWatchdog, stopMicMeter]);

  const startMicMeterLoop = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMeterUnavailable(true);
      return;
    }
    setOutputSinkWarning(null);
    const baseAudio: MediaTrackConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    };
    const openMic = (deviceId: string | null) =>
      navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { ...baseAudio, deviceId: { exact: deviceId } } : baseAudio,
      });

    let stream: MediaStream;
    try {
      stream = micDeviceId ? await openMic(micDeviceId) : await openMic(null);
    } catch {
      if (micDeviceId) {
        try {
          stream = await openMic(null);
          setDeviceListNote("Selected mic was unavailable — using the default input for this run.");
        } catch {
          setMeterUnavailable(true);
          return;
        }
      } else {
        setMeterUnavailable(true);
        return;
      }
    }
    try {
      if (cancelledRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) {
        setMeterUnavailable(true);
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      let ctx: AudioContext;
      try {
        ctx = new AC({ latencyHint: "interactive" });
      } catch {
        ctx = new AC();
      }
      await ctx.resume().catch(() => undefined);
      const ctxSink = ctx as AudioContextWithSink;
      if (outputDeviceId && typeof ctxSink.setSinkId === "function") {
        try {
          await ctxSink.setSinkId(outputDeviceId);
        } catch {
          setOutputSinkWarning("Could not route the meter to the selected output (unsupported or unplugged).");
        }
      }
      const analyser = ctx.createAnalyser();
      analyser.fftSize = METER_FFT_SIZE;
      analyser.smoothingTimeConstant = 0.45;
      const src = ctx.createMediaStreamSource(stream);
      src.connect(analyser);
      // Chromium/WebView often does not run the graph unless something connects toward the destination — tap at zero gain (inaudible).
      const tap = ctx.createGain();
      tap.gain.value = 0;
      analyser.connect(tap);
      tap.connect(ctx.destination);

      const timeDomain = new Float32Array(analyser.fftSize);
      const smoothed = makeIdleMeterBars();
      meterAudioRef.current = { ctx, analyser, stream, timeDomain, smoothed };
      setMeterUnavailable(false);

      const tick = () => {
        const pack = meterAudioRef.current;
        if (!pack) return;
        pack.analyser.getFloatTimeDomainData(pack.timeDomain);
        const td = pack.timeDomain;
        let sumSq = 0;
        for (let i = 0; i < td.length; i++) {
          const v = td[i]!;
          sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / td.length);
        // Map typical speech RMS (~0.005–0.12) into 0–1; pow stretches quiet room noise lower.
        const instant = Math.min(1, Math.pow(rms * 18, 0.72));

        const s = pack.smoothed;
        const phase = performance.now() * 0.0035;
        for (let i = 0; i < METER_BAR_COUNT; i++) {
          const wobble = 0.52 + 0.48 * Math.sin(phase + i * 0.38);
          const target = instant * wobble;
          s[i] = s[i] * 0.76 + target * 0.24;
        }
        setMeterBars([...s]);
        meterRafRef.current = window.requestAnimationFrame(tick);
      };
      meterRafRef.current = window.requestAnimationFrame(tick);
    } catch {
      setMeterUnavailable(true);
      try {
        stream.getTracks().forEach((t) => t.stop());
      } catch {
        /* ignore */
      }
    }
  }, [micDeviceId, outputDeviceId]);

  const startTest = useCallback(() => {
    if (!supported) {
      setHint("Speech recognition is not available in this window — try Chrome or Edge on the desktop.");
      return;
    }
    if (running || arming) {
      setHint("Already listening — use Stop first.");
      return;
    }

    setErr(null);
    setHint(null);
    setLastFinal("");
    setInterpreted(null);
    setLiveLine(null);
    setMeterUnavailable(false);
    cancelledRef.current = false;
    setArming(true);

    void (async () => {
      await startMicMeterLoop();
      if (cancelledRef.current) {
        stopMicMeter();
        setArming(false);
        setVoiceTestExclusive(false);
        window.dispatchEvent(new Event("stitch-voice-test-finished"));
        return;
      }

      setVoiceTestExclusive(true);
      window.dispatchEvent(new Event("stitch-voice-test-pause"));

      window.setTimeout(() => {
        if (cancelledRef.current) {
          stopMicMeter();
          setArming(false);
          setVoiceTestExclusive(false);
          window.dispatchEvent(new Event("stitch-voice-test-finished"));
          return;
        }

      type SpeechCtor = new () => {
        continuous: boolean;
        interimResults: boolean;
        lang: string;
        onstart: (() => void) | null;
        onend: (() => void) | null;
        onerror: ((e: { error?: string }) => void) | null;
        onresult: ((event: { resultIndex: number; results: ArrayLike<{ 0: { transcript?: string }; isFinal?: boolean }> }) => void) | null;
        start: () => void;
        stop: () => void;
      };
      const W = window as Window & { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
      const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
      if (!Ctor) {
        stopMicMeter();
        setArming(false);
        setErr("Speech recognition is not available.");
        setVoiceTestExclusive(false);
        window.dispatchEvent(new Event("stitch-voice-test-finished"));
        return;
      }

      const recognition = new Ctor();
      recognitionRef.current = recognition;
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      watchdogRef.current = window.setTimeout(() => {
        watchdogRef.current = null;
        setErr(
          "The test never heard the microphone start. Try: allow mic for this site, use Chrome/Edge, or if you are in the bundled desktop window try an external browser — WebView sometimes blocks Web Speech.",
        );
        try {
          recognition.stop();
        } catch {
          /* ignore */
        }
        stopTest();
      }, 3200);

      recognition.onstart = () => {
        clearWatchdog();
        setArming(false);
        setRunning(true);
      };

      recognition.onresult = (event) => {
        let text = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const seg = event.results[i]?.[0]?.transcript ?? "";
          text += seg;
        }
        const trimmed = text.trim();
        if (!trimmed) return;
        setLiveLine(trimmed);
        const last = event.results[event.results.length - 1];
        if (last && "isFinal" in last && last.isFinal) {
          setLastFinal(trimmed);
          const cmd = matchStitchVoiceCommand(trimmed);
          setInterpreted(cmd ? describeStitchVoiceCommand(cmd) : "No Stitch shortcut matched — try “open settings” or “scan Gmail”.");
        }
      };

      recognition.onerror = (e) => {
        clearWatchdog();
        const code = e.error || "";
        if (code === "aborted") return;
        setErr(code === "not-allowed" ? "Microphone blocked — allow the site to use the microphone." : `Speech error: ${code || "unknown"}`);
        stopTest();
        setVoiceTestExclusive(false);
        window.dispatchEvent(new Event("stitch-voice-test-finished"));
      };

      recognition.onend = () => {
        clearWatchdog();
        stopMicMeter();
        recognitionRef.current = null;
        setRunning(false);
        setArming(false);
        setLiveLine(null);
        setVoiceTestExclusive(false);
        window.dispatchEvent(new Event("stitch-voice-test-finished"));
      };

      try {
        recognition.start();
      } catch {
        clearWatchdog();
        stopMicMeter();
        recognitionRef.current = null;
        setArming(false);
        setErr("Could not start the speech test (the engine may be busy). Try again in a moment.");
        setVoiceTestExclusive(false);
        window.dispatchEvent(new Event("stitch-voice-test-finished"));
      }
      }, 160);
    })();
  }, [supported, running, arming, stopTest, clearWatchdog, startMicMeterLoop, stopMicMeter]);

  const blocked = !supported;
  const busy = running || arming;
  const selectClass =
    "mt-0.5 w-full max-w-full truncate rounded border border-stitch-border bg-stitch-card px-2 py-1.5 font-body text-[11px] text-stitch-heading outline-none focus:border-stitch-primary-container";
  const micSelectValue = micDeviceId && audioInputs.some((d) => d.deviceId === micDeviceId) ? micDeviceId : "";
  const outSelectValue =
    outputDeviceId && audioOutputs.some((d) => d.deviceId === outputDeviceId) ? outputDeviceId : "";

  return (
    <div className="rounded-lg border border-stitch-border bg-stitch-surface/60 p-3">
      <p className="font-body text-sm font-medium text-stitch-heading">One-shot mic check</p>
      <p className="mt-1 font-body text-[11px] text-stitch-muted">
        Tap <strong className="text-stitch-heading">Run test</strong>, allow the microphone if prompted, then say a single sentence
        (for example <em>open settings</em>). Results appear below.
      </p>
      {voiceActivationOn ? (
        <p className="mt-2 rounded border border-stitch-border/80 bg-stitch-surface-low/80 px-2 py-1.5 font-body text-[11px] text-stitch-text">
          With <strong className="text-stitch-heading">Voice activation</strong> on, Stitch pauses the background listener while this
          test runs, then turns it back on when you finish.
        </p>
      ) : null}

      {navigator.mediaDevices ? (
        <div className="mt-3 space-y-2 rounded border border-stitch-border/80 bg-stitch-surface-low/60 p-2.5">
          <p className="font-body text-[11px] font-semibold text-stitch-heading">Audio devices</p>
          <p className="font-body text-[10px] leading-snug text-stitch-muted">
            Picks the mic for the <strong className="text-stitch-heading">level meter</strong>, this test, and{" "}
            <strong className="text-stitch-heading">local bridge</strong> hands-free listening (same setting as the live voice pill). Web
            Speech-only mode still uses the browser default unless the engine is Auto/bridge.
          </p>
          <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-end">
            <label className="min-w-0 flex-1 font-body text-[10px] text-stitch-text">
              <span className="mb-0.5 block text-stitch-muted">Microphone</span>
              <select
                className={selectClass}
                value={micSelectValue}
                disabled={busy}
                onChange={(e) => {
                  const v = e.target.value;
                  setMicDeviceId(v);
                  writeStitchVoiceInputDeviceId(v);
                }}
              >
                <option value="">System default microphone</option>
                {audioInputs.map((d) => (
                  <option key={`in-${d.deviceId}`} value={d.deviceId}>
                    {formatMediaDeviceLabel(d)}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-0 flex-1 font-body text-[10px] text-stitch-text">
              <span className="mb-0.5 block text-stitch-muted">Output (meter / Web Audio)</span>
              <select
                className={selectClass}
                value={outSelectValue}
                disabled={busy || audioOutputs.length === 0}
                onChange={(e) => {
                  const v = e.target.value;
                  setOutputDeviceId(v);
                  writeVoiceDeviceLs(LS_VOICE_OUTPUT, v);
                }}
              >
                <option value="">Default output</option>
                {audioOutputs.map((d) => (
                  <option key={`out-${d.deviceId}`} value={d.deviceId}>
                    {formatMediaDeviceLabel(d)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={busy || deviceListBusy}
              onClick={() => void relistAudioDevices(true)}
              className="shrink-0 rounded border border-stitch-border bg-stitch-card px-2.5 py-1.5 font-body text-[11px] text-stitch-heading hover:bg-stitch-variant disabled:cursor-not-allowed disabled:opacity-40"
            >
              {deviceListBusy ? "…" : "Refresh names"}
            </button>
          </div>
          {audioOutputs.length === 0 ? (
            <p className="font-body text-[10px] text-stitch-muted">
              No separate output devices listed (normal in some browsers) — playback stays on the system default.
            </p>
          ) : null}
          {deviceListNote ? <p className="font-body text-[10px] text-amber-200/95">{deviceListNote}</p> : null}
          {outputSinkWarning ? <p className="font-body text-[10px] text-amber-200/95">{outputSinkWarning}</p> : null}
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={blocked || busy}
          onClick={() => startTest()}
          className="noir-cmd-primary rounded px-3 py-1.5 font-body text-xs disabled:cursor-not-allowed disabled:opacity-40"
        >
          {arming ? "Preparing…" : running ? "Listening…" : "Run test"}
        </button>
        <button
          type="button"
          disabled={!busy}
          onClick={stopTest}
          className="rounded border border-stitch-border bg-stitch-card px-3 py-1.5 font-body text-xs text-stitch-heading disabled:opacity-40"
        >
          Stop
        </button>
      </div>
      {busy ? (
        <div className="mt-3 space-y-1">
          <p className="font-body text-[10px] leading-snug text-stitch-muted">
            Input level — bars rise from the bottom when the microphone picks up sound (same idea as Teams).
          </p>
          <MicLevelMeter levels={meterBars} />
          {meterUnavailable ? (
            <p className="font-body text-[10px] text-stitch-muted">
              Live level meter could not start in this environment; you can still use the phrase test if Web Speech runs.
            </p>
          ) : null}
        </div>
      ) : null}
      {hint ? <p className="mt-2 font-body text-xs text-amber-200/95">{hint}</p> : null}
      {!supported ? (
        <p className="mt-2 font-body text-xs text-stitch-error">Web Speech is not exposed in this environment (common inside WebView).</p>
      ) : null}
      {liveLine ? (
        <p className="mt-2 font-mono text-[11px] leading-relaxed text-stitch-primary">
          <span className="font-body font-semibold text-stitch-muted">Heard: </span>
          {liveLine}
        </p>
      ) : null}
      {lastFinal && !busy ? (
        <p className="mt-1 font-body text-[11px] text-stitch-text">
          <span className="font-semibold text-stitch-heading">Last phrase: </span>
          {lastFinal}
        </p>
      ) : null}
      {interpreted ? (
        <p className="mt-1 font-body text-[11px] text-stitch-success">
          <span className="font-semibold text-stitch-heading">Stitch understood: </span>
          {interpreted}
        </p>
      ) : null}
      {err ? <p className="mt-2 font-body text-xs text-stitch-error">{err}</p> : null}
    </div>
  );
}
