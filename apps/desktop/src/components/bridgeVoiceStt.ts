/**
 * Mic → WAV → stitch_rag_bridge POST /api/voice/transcribe (server-side STT: Whisper or Google).
 * Works in Tauri / WebView2 where the browser Web Speech API does not return transcripts.
 */
import { stitchRagApiUrl } from "../lib/stitchBridge";

const TARGET_SAMPLE_RATE = 16000;
const MIN_UTTERANCE_SEC = 0.28;
const SILENCE_END_MS = 620;
const MAX_UTTERANCE_SEC = 10;
/** Normal speech is often ~0.006–0.02 RMS here; WebView mics can sit lower than desktop meters suggest. */
const SPEECH_RMS = 0.0045;
const SILENCE_RMS = 0.004;

/** High-level lifecycle for the bridge STT loop — drives status text in the voice pill. */
export type BridgeVoicePhase =
  | "init"
  | "mic_ready"
  | "awaiting_speech"
  | "capturing_speech"
  | "sending_to_server";

export type BridgeVoiceSttHandlers = {
  onUtterance: (text: string) => void;
  onCaption?: (text: string) => void;
  onLevel?: (level01: number) => void;
  onListening?: (active: boolean) => void;
  onError?: (message: string) => void;
  /** Fired only when the phase changes (not every audio buffer). */
  onPhase?: (phase: BridgeVoicePhase) => void;
};

export type StartBridgeVoiceSttOptions = {
  /** `MediaDeviceInfo.deviceId` from the mic picker — omit or empty for OS default input. */
  inputDeviceId?: string | null;
};

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

/** 16-bit mono little-endian WAV (PCM). */
export function encodeWav16Mono(samples: Int16Array, sampleRate: number): ArrayBuffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    view.setInt16(o, samples[i]!, true);
  }
  return buffer;
}

function floatToI16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const x = Math.max(-1, Math.min(1, input[i] ?? 0));
    out[i] = x < 0 ? Math.round(x * 0x8000) : Math.round(x * 0x7fff);
  }
  return out;
}

function resampleLinear(input: Float32Array, inputRate: number, outRate: number): Float32Array {
  if (inputRate === outRate || input.length === 0) return input;
  const ratio = inputRate / outRate;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcPos = i * ratio;
    const j0 = Math.floor(srcPos);
    const j1 = Math.min(input.length - 1, j0 + 1);
    const f = srcPos - j0;
    out[i] = (1 - f) * (input[j0] ?? 0) + f * (input[j1] ?? 0);
  }
  return out;
}

function mergeInt16Chunks(chunks: Int16Array[], totalSamples: number): Int16Array {
  const merged = new Int16Array(totalSamples);
  let o = 0;
  for (const c of chunks) {
    merged.set(c, o);
    o += c.length;
  }
  return merged;
}

function blockRmsI16(block: Int16Array): number {
  if (block.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < block.length; i++) {
    const v = block[i] ?? 0;
    sum += v * v;
  }
  return Math.sqrt(sum / block.length) / 32768;
}

/**
 * Start continuous listening. Returns `stop` (idempotent). Uses ScriptProcessor + zero-gain sink (no speaker playback).
 */
export function startBridgeVoiceStt(h: BridgeVoiceSttHandlers, opts?: StartBridgeVoiceSttOptions): () => void {
  let stopped = false;
  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  let processor: ScriptProcessorNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let mute: GainNode | null = null;
  let busy = false;

  const chunks: Int16Array[] = [];
  let totalSamples = 0;
  let inSpeech = false;
  let wasInSpeech = false;
  let silenceMs = 0;
  let lastText = "";
  let lastTextAt = 0;
  const minUtteranceSamples = Math.floor(TARGET_SAMPLE_RATE * MIN_UTTERANCE_SEC);

  let lastPhase: BridgeVoicePhase | "" = "";
  const emitPhase = (p: BridgeVoicePhase) => {
    if (lastPhase === p) return;
    lastPhase = p;
    h.onPhase?.(p);
  };

  const stop = () => {
    stopped = true;
    h.onListening?.(false);
    try {
      processor?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      source?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      mute?.disconnect();
    } catch {
      /* ignore */
    }
    processor = null;
    source = null;
    mute = null;
    try {
      void ctx?.close();
    } catch {
      /* ignore */
    }
    ctx = null;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  };

  async function transmit(): Promise<void> {
    if (totalSamples < minUtteranceSamples || busy || stopped) return;
    busy = true;
    emitPhase("sending_to_server");
    const pcm = mergeInt16Chunks(chunks, totalSamples);
    chunks.length = 0;
    totalSamples = 0;
    inSpeech = false;
    wasInSpeech = false;
    silenceMs = 0;
    const wav = encodeWav16Mono(pcm, TARGET_SAMPLE_RATE);
    h.onCaption?.("[bridge] (uploading clip…)");
    try {
      const res = await fetch(stitchRagApiUrl("/api/voice/transcribe"), {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: wav,
        // First Whisper load can take well over a minute on CPU.
        signal: AbortSignal.timeout(180_000),
      });
      const rawText = await res.text();
      let payload: { text?: string; error?: string; note?: string } = {};
      try {
        payload = JSON.parse(rawText) as typeof payload;
      } catch {
        h.onError?.(rawText.slice(0, 200) || `HTTP ${res.status}`);
        return;
      }
      if (!res.ok) {
        h.onError?.(payload.error || `HTTP ${res.status}`);
        return;
      }
      const text = (payload.text || "").trim();
      const cap = text || (payload.note === "unintelligible" ? "(unclear)" : "");
      h.onCaption?.(cap);
      if (!text) return;
      if (text === lastText && Date.now() - lastTextAt < 2000) return;
      lastText = text;
      lastTextAt = Date.now();
      h.onUtterance(text);
    } catch (e) {
      h.onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      busy = false;
      if (!stopped) emitPhase("awaiting_speech");
    }
  }

  void (async () => {
    try {
      emitPhase("init");
      const preferredId = (opts?.inputDeviceId || "").trim();
      const openMic = (deviceId: string) =>
        navigator.mediaDevices.getUserMedia(
          deviceId ? { audio: { deviceId: { exact: deviceId } } } : { audio: true },
        );
      try {
        stream = await openMic(preferredId);
      } catch (firstErr) {
        if (!preferredId) throw firstErr;
        try {
          stream = await openMic("");
          h.onCaption?.("[bridge] Selected mic failed to open — using the default input instead.");
        } catch {
          throw firstErr;
        }
      }
      if (stopped) return;
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) throw new Error("Web Audio API not available");
      ctx = new AC();
      // WebView2 / Chrome often start suspended; ScriptProcessor delivers silence until resumed.
      if (ctx.state === "suspended") {
        await ctx.resume().catch(() => undefined);
      }
      const inRate = ctx.sampleRate;
      source = ctx.createMediaStreamSource(stream);
      const bufferSize = 4096;
      const ch = source.channelCount || 1;
      processor = ctx.createScriptProcessor(bufferSize, ch, 1);
      mute = ctx.createGain();
      mute.gain.value = 0;
      processor.onaudioprocess = (ev) => {
        if (stopped) return;
        if (busy) return;
        const buf = ev.inputBuffer;
        const frame = buf.length;
        const chCount = buf.numberOfChannels;
        let mono = buf.getChannelData(0);
        if (chCount > 1) {
          const m = new Float32Array(frame);
          for (let i = 0; i < frame; i++) {
            let s = 0;
            for (let c = 0; c < chCount; c++) s += buf.getChannelData(c)[i] ?? 0;
            m[i] = s / chCount;
          }
          mono = m;
        }
        const resampled = resampleLinear(mono, inRate, TARGET_SAMPLE_RATE);
        const block = floatToI16(resampled);
        const rms = blockRmsI16(block);
        h.onLevel?.(Math.min(1, rms * 10));

        const blockMs = (block.length / TARGET_SAMPLE_RATE) * 1000;
        if (rms > SPEECH_RMS) {
          inSpeech = true;
          silenceMs = 0;
        } else if (inSpeech) {
          silenceMs += blockMs;
        }

        if (inSpeech && !wasInSpeech) emitPhase("capturing_speech");
        if (!inSpeech && wasInSpeech) emitPhase("awaiting_speech");
        wasInSpeech = inSpeech;

        if (inSpeech) {
          chunks.push(block);
          totalSamples += block.length;
        }

        const maxSamples = Math.floor(TARGET_SAMPLE_RATE * MAX_UTTERANCE_SEC);
        if (totalSamples >= maxSamples) {
          void transmit();
          return;
        }

        if (inSpeech && silenceMs >= SILENCE_END_MS && rms < SILENCE_RMS && totalSamples >= minUtteranceSamples) {
          void transmit();
        }
      };
      source.connect(processor);
      processor.connect(mute);
      mute.connect(ctx.destination);
      emitPhase("mic_ready");
      emitPhase("awaiting_speech");
      h.onListening?.(true);
    } catch (e) {
      h.onError?.(e instanceof Error ? e.message : String(e));
      stop();
    }
  })();

  return stop;
}
