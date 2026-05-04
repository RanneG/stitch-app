import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

type FaceStatus = { ok: boolean; enrolled: boolean; error?: string };
type VerifyResponse = {
  verified: boolean;
  match?: boolean;
  confidence: number;
  liveness_passed: boolean;
  liveness_detail?: string;
  error?: string;
  threshold?: number;
};

export type FaceVerificationPanelProps = {
  /**
   * Account email from app auth (e.g. localStorage via Settings).
   * When set, the panel pings `/api/face/status` after the bridge is up and jumps to enroll or verify.
   */
  initialEmail?: string;
  /** `purchase`: skip email/enroll UI; verify then call `onPurchaseVerified`. */
  purpose?: "settings" | "purchase";
  /** Line shown under the title when `purpose="purchase"` (e.g. merchant · amount). */
  purchaseSubtitle?: string;
  onPurchaseVerified?: () => void;
  onPurchaseCancel?: () => void;
};

const SESSION_VERIFIED_KEY = "stitch.face_verified_email";
const VERIFY_TIMEOUT_MS = 30_000;
const LIVENESS_FPS = 8;
const LIVENESS_DURATION_MS = 2500;

/** Oval target in normalized video coordinates (0–100). */
const OVAL = { cx: 50, cy: 42, rx: 30, ry: 38 };
const AREA_MIN = 8;
const AREA_MAX = 44;
const LIGHT_MIN = 75;
const LIGHT_MAX = 225;
const ALIGN_HOLD_MS = 550;
const COUNTDOWN_STEP_MS = 850;
const GUIDE_DEBOUNCE_FRAMES = 10;
/** Strict mode: green oval / countdown when capture-side match quality reaches this (0–100). */
const ENROLL_CAPTURE_QUALITY_READY_STRICT = 55;
/** Easy mode: lower bar so demo captures succeed more often. */
const ENROLL_CAPTURE_QUALITY_READY_EASY = 48;
const SESSION_FACE_SETUP_SKIPPED_KEY = "stitch.face_setup_skipped";
const LS_FACE_CAMERA_DEVICE = "stitch.faceCameraDeviceId";

function readFaceCameraLs(): string {
  try {
    const v = localStorage.getItem(LS_FACE_CAMERA_DEVICE);
    return v && v.trim() ? v.trim() : "";
  } catch {
    return "";
  }
}

function writeFaceCameraLs(value: string): void {
  try {
    if (value.trim()) localStorage.setItem(LS_FACE_CAMERA_DEVICE, value.trim());
    else localStorage.removeItem(LS_FACE_CAMERA_DEVICE);
  } catch {
    /* ignore */
  }
}

function videoDeviceOptionLabel(d: MediaDeviceInfo): string {
  if (d.label?.trim()) return d.label.trim();
  return d.deviceId ? `Camera (${d.deviceId.slice(0, 8)}…)` : "Camera";
}

/** Primary CTA — matches SubscriptionCard (`noir-cmd-primary`). */
const btnPrimary = "noir-cmd-primary rounded-sm px-4 py-2 font-body text-xs disabled:opacity-50";

/** Secondary — black border + elevated surface + neo-shadow-sm (matches card actions). */
const btnOutline =
  "rounded-sm border-2 border-black bg-stitch-elevated px-4 py-2 font-body text-xs font-semibold text-stitch-heading neo-shadow-sm outline-none transition hover:bg-stitch-variant active:translate-x-0.5 active:translate-y-0.5 active:shadow-none disabled:opacity-50";

/** Accent outline — primary container border + primary text on surface. */
const btnOutlineElectric =
  "rounded-sm border-2 border-stitch-primary-container bg-stitch-surface px-4 py-2 font-body text-xs font-semibold text-stitch-primary neo-shadow-sm outline-none transition hover:bg-stitch-card active:translate-x-0.5 active:translate-y-0.5 active:shadow-none disabled:opacity-50";

function FaceHudCorners({ active }: { active: boolean }) {
  const edge = active ? "border-stitch-primary-container" : "border-stitch-surface-secondary";
  return (
    <div className="pointer-events-none absolute inset-2 sm:inset-3" aria-hidden>
      <div className={`absolute left-0 top-0 h-7 w-7 border-l-2 border-t-2 ${edge}`} />
      <div className={`absolute right-0 top-0 h-7 w-7 border-r-2 border-t-2 ${edge}`} />
      <div className={`absolute bottom-0 left-0 h-7 w-7 border-b-2 border-l-2 ${edge}`} />
      <div className={`absolute bottom-0 right-0 h-7 w-7 border-b-2 border-r-2 ${edge}`} />
    </div>
  );
}

export type FaceHudMetrics = {
  /** MediaPipe category score 0–100 when present. */
  modelPct?: number;
  areaPct: number;
  inOval: boolean;
  brightness: number | null;
};

function FaceHudBoundingBox({
  faceBox,
  metrics,
  tone,
}: {
  faceBox: { left: number; top: number; width: number; height: number };
  metrics: FaceHudMetrics | null;
  tone: "muted" | "good" | "hot";
}) {
  const border =
    tone === "good" || tone === "hot" ? "border-stitch-primary-container" : "border-stitch-surface-secondary";
  const boxBottom = faceBox.top + faceBox.height;
  const roomBelowPct = 100 - boxBottom;
  const chipBelow = roomBelowPct >= 12;

  const chipStyle: CSSProperties = chipBelow
    ? {
        left: `${faceBox.left + faceBox.width / 2}%`,
        top: `${boxBottom}%`,
        transform: "translate(-50%, 8px)",
      }
    : {
        left: `${faceBox.left + faceBox.width / 2}%`,
        top: `${faceBox.top}%`,
        transform: "translate(-50%, calc(-100% - 10px))",
      };

  const chipTitle =
    "Generic on-device face finder (not who you are). Pets, statues, and photos can sometimes score like a face — Run check compares to your enrolled templates.";
  const chipInner = metrics ? (
    <div
      className="rounded-sm border border-cyan-400/55 bg-black/92 px-2 py-1 font-mono text-[7px] leading-snug text-cyan-100 shadow-md sm:text-[8px]"
      title={chipTitle}
    >
      <div className="font-display text-[7px] font-bold uppercase tracking-[0.1em] text-cyan-200 sm:text-[8px]">Human-face hint</div>
      <div className="mt-0.5 text-[6px] leading-tight text-cyan-300/85 sm:text-[7px]">Not identity — outline only</div>
      <div className="mt-0.5 text-cyan-50/95">
        <span title="MediaPipe score; weak matches are hidden in the UI to reduce pet false alarms">
          Detector {metrics.modelPct != null ? `${metrics.modelPct}%` : "—"}
        </span>
        <span className="text-cyan-300/80"> · </span>
        <span title="Bounding box area as % of frame">Area {metrics.areaPct.toFixed(1)}%</span>
      </div>
      <div className="mt-0.5 text-cyan-200/90">
        <span title="Overlap with guide oval">{metrics.inOval ? "Oval ✓" : "Oval …"}</span>
        <span className="text-cyan-300/80"> · </span>
        <span title="Mean luma (0–255)">{metrics.brightness != null ? `Light ${Math.round(metrics.brightness)}` : "Light —"}</span>
      </div>
    </div>
  ) : (
    <div
      className="rounded-sm border border-cyan-500/40 bg-black/85 px-2 py-1 font-mono text-[7px] text-cyan-200 sm:text-[8px]"
      title={chipTitle}
    >
      <div className="font-display text-[7px] font-bold uppercase tracking-[0.1em] text-cyan-200 sm:text-[8px]">Human-face hint</div>
      <div className="mt-0.5 text-[6px] text-cyan-300/80 sm:text-[7px]">Scanning…</div>
    </div>
  );

  return (
    <>
      <div
        className={`pointer-events-none absolute z-[4] border-2 ${border}`}
        style={{
          left: `${faceBox.left}%`,
          top: `${faceBox.top}%`,
          width: `${faceBox.width}%`,
          height: `${faceBox.height}%`,
        }}
      />
      <div className="pointer-events-none absolute z-[6] w-max min-w-[7.5rem] max-w-[min(92vw,15rem)]" style={chipStyle}>
        {chipInner}
      </div>
    </>
  );
}

function CircularConfidenceMeter({ value01, label }: { value01: number; label: string }) {
  const pct = Math.round(Math.min(100, Math.max(0, value01 * 100)));
  const r = 36;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  return (
    <div className="flex flex-col items-center gap-2" role="img" aria-label={`${label}: ${pct} percent`}>
      <div className="relative h-[100px] w-[100px]">
        <svg width="100" height="100" viewBox="0 0 100 100" className="rotate-[-90deg]" aria-hidden>
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--stitch-surface-secondary)" strokeWidth="6" />
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke="var(--stitch-primary-container)"
            strokeWidth="6"
            strokeLinecap="square"
            strokeDasharray={`${dash} ${c}`}
            className="transition-[stroke-dasharray] duration-500 ease-out"
          />
        </svg>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="font-display text-xl font-bold tracking-tight text-stitch-heading">{pct}%</span>
        </div>
      </div>
      <p className="max-w-[9rem] text-center font-display text-[10px] font-bold uppercase tracking-[0.05em] text-stitch-text">
        {label}
      </p>
    </div>
  );
}

/**
 * In Vite dev, default to calling Flask on 127.0.0.1:8765 so large JSON POSTs are not mangled by the Vite proxy.
 */
function stitchRagApiOrigin(): string {
  if (import.meta.env.VITE_STITCH_RAG_USE_PROXY === "1") return "";
  const custom = (import.meta.env.VITE_STITCH_RAG_BRIDGE_ORIGIN as string | undefined)?.trim();
  if (custom) return custom.replace(/\/$/, "");
  if (import.meta.env.DEV) return "http://127.0.0.1:8765";
  if (typeof window !== "undefined") {
    const { hostname, port } = window.location;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      if (port === "1420" || port === "5173") return "http://127.0.0.1:8765";
    }
  }
  return "";
}

function stitchRagApiUrl(path: string): string {
  const base = stitchRagApiOrigin();
  const p = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}

function frameToJpegDataUrl(
  video: HTMLVideoElement,
  opts?: { quality?: number; maxWidth?: number },
): string {
  const quality = opts?.quality ?? 0.82;
  const cap = opts?.maxWidth ?? 640;
  const w = Math.max(1, Math.min(cap, video.videoWidth));
  const h = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * w));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(video, 0, 0, w, h);
  return c.toDataURL("image/jpeg", quality);
}

function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError) return true;
  if (e instanceof Error && /fetch|network|failed to load/i.test(e.message)) return true;
  return false;
}

const HTML_INSTEAD_OF_JSON_HINT =
  "Received a web page instead of API JSON. Stop and restart `npm run dev:browser` so Vite reloads the proxy, and ensure `vite.config.ts` maps `/api` to http://127.0.0.1:8765 (not only `/api/rag`).";

const HTML_WRONG_PORT_APP_HINT =
  "The server on port 8765 returned an HTML error page instead of JSON — often another process is using that port, or an older bridge without face routes. Stop it, then from the cursor_linkup_mcp repo run `stitch_rag_bridge.py` (default 8765). Quick check: `GET http://127.0.0.1:8765/api/health` should return JSON like {\"ok\":true}.";

async function readJsonFromResponse(res: Response): Promise<{ data: unknown; parseError: string | null }> {
  const text = await res.text();
  const trimmed = text.trimStart();
  if (trimmed.startsWith("<!") || trimmed.toLowerCase().startsWith("<!doctype") || trimmed.toLowerCase().startsWith("<html")) {
    if (res.status === 200) {
      return { data: null, parseError: HTML_INSTEAD_OF_JSON_HINT };
    }
    if (res.status === 404 || res.status === 405) {
      return { data: null, parseError: HTML_WRONG_PORT_APP_HINT };
    }
    return {
      data: null,
      parseError: `Server returned HTML (${res.status}) instead of JSON — almost always an old Python process still bound to port 8765 without the latest bridge code. Stop every stitch_rag_bridge / python on 8765, then start again from cursor_linkup_mcp: .\\.venv\\Scripts\\python.exe stitch_rag_bridge.py (watch the terminal for a traceback). After code changes, npm run dev:browser only matters for Vite/proxy; face calls already use 127.0.0.1:8765 in local dev.`,
    };
  }
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  const looksJson =
    ct.includes("application/json") || ct.includes("+json") || trimmed.startsWith("{") || trimmed.startsWith("[");
  if (!trimmed) {
    return { data: {}, parseError: null };
  }
  if (!looksJson) {
    return {
      data: null,
      parseError: `Expected JSON but got non-JSON (${res.status}): ${text.slice(0, 160)}${text.length > 160 ? "…" : ""}`,
    };
  }
  try {
    return { data: JSON.parse(text) as unknown, parseError: null };
  } catch {
    return {
      data: null,
      parseError: `Invalid JSON (${res.status}): ${text.slice(0, 160)}${text.length > 160 ? "…" : ""}`,
    };
  }
}

function insideOval(face: { left: number; top: number; width: number; height: number }): boolean {
  const cx = face.left + face.width / 2;
  const cy = face.top + face.height / 2;
  const dx = (cx - OVAL.cx) / OVAL.rx;
  const dy = (cy - OVAL.cy) / OVAL.ry;
  return dx * dx + dy * dy <= 1.05;
}

function faceAreaPercent(face: { left: number; top: number; width: number; height: number }): number {
  return (face.width * face.height) / 100;
}

/**
 * Extra guard on top of MediaPipe score: upright human faces are usually taller-than-wide in this view.
 * Many pets still score high but land outside this band.
 */
function passesFaceLikeHumanHud(
  box: { left: number; top: number; width: number; height: number },
  easy: boolean,
): boolean {
  const ar = box.width / Math.max(0.02, box.height);
  const lo = easy ? 0.64 : 0.7;
  const hi = easy ? 0.94 : 0.88;
  if (ar < lo || ar > hi) return false;
  const area = faceAreaPercent(box);
  const aMin = easy ? 5.2 : 6.2;
  const aMax = easy ? 36 : 32;
  return area >= aMin && area <= aMax;
}

function sampleVideoBrightness(video: HTMLVideoElement): number | null {
  if (video.videoWidth < 2 || video.videoHeight < 2) return null;
  const c = document.createElement("canvas");
  const s = 48;
  c.width = s;
  c.height = s;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, s, s);
  const data = ctx.getImageData(0, 0, s, s).data;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
  }
  return sum / (data.length / 4);
}

/**
 * Local face verification: bridge `/api/face/*`.
 * Guided single-frame enrollment + optional legacy multi-angle + post-enroll test.
 */
export function FaceVerificationPanel({
  initialEmail = "",
  purpose = "settings",
  purchaseSubtitle,
  onPurchaseVerified,
  onPurchaseCancel,
}: FaceVerificationPanelProps) {
  type Step = "email" | "enroll" | "enroll_test" | "verify" | "success" | "purchase_need_enroll";
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState(() => initialEmail.trim());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bridgeState, setBridgeState] = useState<"checking" | "up" | "down">("checking");
  const [confidence, setConfidence] = useState(0);
  const [livenessHint, setLivenessHint] = useState("Please blink naturally a few times, then hold still.");
  const [liveDetail, setLiveDetail] = useState<string | null>(null);
  const [, setLivenessFails] = useState(0);
  const [multiAdvanced, setMultiAdvanced] = useState(false);
  const [multiShots, setMultiShots] = useState<string[]>([]);

  const [enrollGuideStarted, setEnrollGuideStarted] = useState(false);
  const [guidanceText, setGuidanceText] = useState("Center face, good lighting, natural blink.");
  const [enrollQualityPct, setEnrollQualityPct] = useState(0);
  const [ovalGood, setOvalGood] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [enrollProcessing, setEnrollProcessing] = useState(false);
  const [pendingCapture, setPendingCapture] = useState<string | null>(null);
  /** Demo default: easier capture, lower verify threshold, friendlier copy. */
  const [easyMode, setEasyMode] = useState(true);
  const [enrollFailCount, setEnrollFailCount] = useState(0);
  const [lastEnrollTemplateScore, setLastEnrollTemplateScore] = useState<number | null>(null);
  const [faceSkippedDemo, setFaceSkippedDemo] = useState(false);
  const [enrollTestBusy, setEnrollTestBusy] = useState(false);
  const [enrollTestResult, setEnrollTestResult] = useState<{
    ok: boolean;
    confidence: number;
    detail: string;
  } | null>(null);

  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([]);
  const [cameraDeviceId, setCameraDeviceId] = useState(() => readFaceCameraLs());
  const [cameraListBusy, setCameraListBusy] = useState(false);
  const [cameraListNote, setCameraListNote] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const easyModeRef = useRef(true);
  easyModeRef.current = easyMode;
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const enrollGuideRafRef = useRef<number>(0);
  const livenessFailRef = useRef(0);
  const bootstrapRef = useRef(false);
  const [streamEpoch, setStreamEpoch] = useState(0);
  const [faceBox, setFaceBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [faceHudMetrics, setFaceHudMetrics] = useState<FaceHudMetrics | null>(null);
  const faceBoxRef = useRef(faceBox);
  faceBoxRef.current = faceBox;
  const faceHudBrightnessRef = useRef<{ t: number; v: number | null }>({ t: 0, v: null });

  const alignSinceRef = useRef<number | null>(null);
  const guideFrameRef = useRef(0);
  const countdownCaptureDoneRef = useRef(false);

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    if (enrollGuideRafRef.current) cancelAnimationFrame(enrollGuideRafRef.current);
    enrollGuideRafRef.current = 0;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setFaceBox(null);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const relistVideoDevices = useCallback(async (requestCameraPermission: boolean) => {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== "function") return;
    if (!requestCameraPermission) setCameraListNote(null);
    if (requestCameraPermission) {
      setCameraListBusy(true);
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        s.getTracks().forEach((t) => t.stop());
        setCameraListNote(null);
      } catch {
        setCameraListNote("Allow the camera once to load friendly device names.");
      } finally {
        setCameraListBusy(false);
      }
    }
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setVideoInputs(list.filter((d) => d.kind === "videoinput"));
    } catch {
      setCameraListNote("Could not enumerate cameras.");
    }
  }, []);

  useEffect(() => {
    void relistVideoDevices(false);
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    const onChange = () => void relistVideoDevices(false);
    md.addEventListener("devicechange", onChange);
    return () => md.removeEventListener("devicechange", onChange);
  }, [relistVideoDevices]);

  const skipForDemoAfterFailedEnrolls = useCallback(() => {
    stopCamera();
    setError(null);
    setPendingCapture(null);
    setEnrollFailCount(0);
    sessionStorage.setItem(SESSION_FACE_SETUP_SKIPPED_KEY, "1");
    if (purpose === "settings") {
      setFaceSkippedDemo(true);
      setStep("success");
    } else {
      onPurchaseCancel?.();
    }
  }, [email, initialEmail, purpose, stopCamera, onPurchaseCancel]);

  const checkBridge = useCallback(async () => {
    setBridgeState("checking");
    setError(null);
    const urls = [stitchRagApiUrl("/api/health"), stitchRagApiUrl("/health")];
    try {
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i]!;
        const res = await fetch(url, { method: "GET" });
        const { data, parseError } = await readJsonFromResponse(res);
        if (parseError) {
          if (i < urls.length - 1) continue;
          setError(parseError);
          setBridgeState("down");
          return false;
        }
        const payload = data as { ok?: boolean };
        if (res.ok && payload?.ok) {
          setBridgeState("up");
          return true;
        }
        if (res.status === 404 && i < urls.length - 1) continue;
        setError(`Health check failed (${res.status}) from ${url}`);
        setBridgeState("down");
        return false;
      }
      setError("Bridge returned 404 for /api/health and /health — restart stitch_rag_bridge.py so it picks up the latest routes.");
      setBridgeState("down");
      return false;
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const fetchFailed = /failed to fetch|networkerror|load failed/i.test(raw);
      setError(
        fetchFailed
          ? `${raw} — The UI calls relative URLs like /api/health; those only reach Flask when the Vite dev server is running (e.g. from Stitch apps/desktop: npm run dev:browser, usually http://localhost:1420). If the bridge is already up on 8765, start or restart Vite, then Retry.`
          : `${raw} (is the dev server proxy running?)`,
      );
      setBridgeState("down");
      return false;
    }
  }, []);

  useEffect(() => {
    void checkBridge();
  }, [checkBridge]);

  useEffect(() => {
    setEmail(initialEmail.trim());
    bootstrapRef.current = false;
    if (!initialEmail.trim()) {
      setStep("email");
    }
  }, [initialEmail]);

  useEffect(() => {
    if (bridgeState !== "up" || bootstrapRef.current) return;
    const em = initialEmail.trim();
    if (!em) return;
    bootstrapRef.current = true;
    let cancelled = false;
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(stitchRagApiUrl(`/api/face/status?email=${encodeURIComponent(em)}`));
        const { data: raw, parseError } = await readJsonFromResponse(res);
        if (cancelled) return;
        if (parseError) throw new Error(parseError);
        const data = raw as FaceStatus;
        if (!res.ok || !data.ok) throw new Error(data.error || res.statusText || `HTTP ${res.status}`);
        setEmail(em);
        if (purpose === "purchase") {
          setStep(data.enrolled ? "verify" : "purchase_need_enroll");
        } else {
          setStep(data.enrolled ? "verify" : "enroll");
        }
      } catch (e) {
        if (cancelled) return;
        bootstrapRef.current = false;
        if (isNetworkError(e)) {
          setBridgeState("down");
          setError("Cannot reach the bridge — is stitch_rag_bridge.py running on port 8765?");
        } else {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bridgeState, initialEmail, purpose]);

  const startCamera = useCallback(async (): Promise<boolean> => {
    setError(null);
    const pickVideo = () => {
      const id = cameraDeviceId.trim();
      if (id) return { deviceId: { exact: id } } as MediaTrackConstraints;
      return { facingMode: "user" } as MediaTrackConstraints;
    };
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: pickVideo(), audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setStreamEpoch((n) => n + 1);
      return true;
    } catch {
      if (cameraDeviceId.trim()) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            await videoRef.current.play().catch(() => undefined);
          }
          setStreamEpoch((n) => n + 1);
          setCameraListNote("Selected camera was unavailable — using the default camera for this session.");
          return true;
        } catch {
          /* fall through */
        }
      }
      setError("Camera permission denied — allow camera for this site, then retry.");
      return false;
    }
  }, [cameraDeviceId, email, initialEmail]);

  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream || (step !== "verify" && step !== "enroll" && step !== "enroll_test")) return;

    let cancelled = false;
    let detector: {
      detectForVideo: (
        v: HTMLVideoElement,
        ts: number,
      ) => {
        detections?: Array<{
          boundingBox?: { originX: number; originY: number; width: number; height: number };
          categories?: Array<{ score?: number; categoryName?: string }>;
        }>;
      };
    } | null = null;

    const tick = async () => {
      if (cancelled || !video || !detector) return;
      if (video.readyState < 2 || video.videoWidth === 0) {
        rafRef.current = requestAnimationFrame(() => void tick());
        return;
      }
      try {
        const r = detector.detectForVideo(video, performance.now());
        const det = r.detections?.[0];
        const bb = det?.boundingBox;
        const rawScore = det?.categories?.[0]?.score;
        const modelPct = typeof rawScore === "number" && !Number.isNaN(rawScore) ? Math.round(rawScore * 100) : undefined;
        /** Hide weak “face-like” boxes (pets, clutter) from the HUD; stricter when Easy Mode is off. */
        const minHudModelPct = easyModeRef.current ? 72 : 82;
        if (!bb || modelPct == null || modelPct < minHudModelPct) {
          setFaceBox(null);
          setFaceHudMetrics(null);
        } else {
          const clamp = (n: number) => Math.max(0, Math.min(100, n));
          const box = {
            left: clamp((bb.originX / video.videoWidth) * 100),
            top: clamp((bb.originY / video.videoHeight) * 100),
            width: clamp((bb.width / video.videoWidth) * 100),
            height: clamp((bb.height / video.videoHeight) * 100),
          };
          if (!passesFaceLikeHumanHud(box, easyModeRef.current)) {
            setFaceBox(null);
            setFaceHudMetrics(null);
          } else {
          const areaPct = faceAreaPercent(box);
          const inOval = insideOval(box);
          const now = performance.now();
          let brightness = faceHudBrightnessRef.current.v;
          if (now - faceHudBrightnessRef.current.t > 160) {
            faceHudBrightnessRef.current.t = now;
            brightness = sampleVideoBrightness(video);
            faceHudBrightnessRef.current.v = brightness;
          }
          setFaceBox(box);
          setFaceHudMetrics((prev) => {
            const next: FaceHudMetrics = { modelPct, areaPct, inOval, brightness };
            if (
              prev &&
              prev.modelPct === next.modelPct &&
              Math.abs(prev.areaPct - next.areaPct) < 0.35 &&
              prev.inOval === next.inOval &&
              prev.brightness === next.brightness
            ) {
              return prev;
            }
            return next;
          });
          }
        }
      } catch {
        setFaceBox(null);
        setFaceHudMetrics(null);
      }
      rafRef.current = requestAnimationFrame(() => void tick());
    };

    const run = async () => {
      try {
        const vision = await import("@mediapipe/tasks-vision");
        const filesetResolver = await vision.FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm",
        );
        const easy = easyModeRef.current;
        detector = await vision.FaceDetector.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
          },
          runningMode: "VIDEO",
          minDetectionConfidence: easy ? 0.68 : 0.78,
          minSuppressionThreshold: easy ? 0.42 : 0.52,
        });
        if (!cancelled) rafRef.current = requestAnimationFrame(() => void tick());
      } catch {
        /* optional overlay */
      }
    };
    void run();
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setFaceBox(null);
      setFaceHudMetrics(null);
    };
  }, [step, streamEpoch, easyMode]);

  useEffect(() => {
    if (step !== "enroll" || !enrollGuideStarted || multiAdvanced || countdown !== null || enrollProcessing) {
      if (enrollGuideRafRef.current) cancelAnimationFrame(enrollGuideRafRef.current);
      enrollGuideRafRef.current = 0;
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      guideFrameRef.current += 1;
      if (guideFrameRef.current % GUIDE_DEBOUNCE_FRAMES !== 0) {
        enrollGuideRafRef.current = requestAnimationFrame(tick);
        return;
      }

      const fb = faceBoxRef.current;
      const light = sampleVideoBrightness(video);
      const easy = easyModeRef.current;
      const lightMin = easy ? 58 : LIGHT_MIN;
      const lightMax = easy ? 238 : LIGHT_MAX;
      const areaMin = easy ? 6 : AREA_MIN;
      const areaMax = easy ? 48 : AREA_MAX;

      if (!fb) {
        setOvalGood(false);
        setEnrollQualityPct(0);
        setGuidanceText(
          easy
            ? "No face yet — center face, good lighting, natural blink."
            : "No face detected — center your face, improve lighting, or move the camera.",
        );
        alignSinceRef.current = null;
        setCountdown(null);
      } else {
        const area = faceAreaPercent(fb);
        const inOval = insideOval(fb);
        setOvalGood(inOval);

        let msg = easy ? "Almost there — small adjustments help." : "Face detected — adjust position.";
        let q = easy ? 42 : 35;
        if (light != null && (light < lightMin || light > lightMax)) {
          msg = light < lightMin ? "A bit more light helps the demo." : "Ease off bright glare if you can.";
          q = easy ? 32 : 25;
        } else if (area < areaMin) {
          msg = easy ? "Scoot a little closer — we almost have you." : "Face too small — move closer to the camera.";
          q = 30 + Math.min(40, (area / areaMin) * 40);
        } else if (area > areaMax) {
          msg = easy ? "Tiny step back — perfect framing incoming." : "Face too large — move back slightly.";
          q = 30 + Math.min(40, ((areaMax + 8 - area) / 8) * 40);
        } else if (!inOval) {
          msg = easy ? "Center face, good lighting, natural blink — line up the oval." : "Center your face in the oval.";
          q = 45 + Math.min(35, area * 0.5);
        } else {
          msg = "Hold still — lining up…";
          q = 55 + Math.min(45, (area / areaMax) * 45);
          if (light != null && light >= lightMin && light <= lightMax) q += easy ? 12 : 10;
        }
        setEnrollQualityPct(Math.round(Math.min(100, q)));
        setGuidanceText(msg);

        const ready =
          fb &&
          inOval &&
          area >= areaMin &&
          area <= areaMax &&
          light != null &&
          light >= lightMin &&
          light <= lightMax;

        const now = Date.now();
        if (ready) {
          if (alignSinceRef.current == null) alignSinceRef.current = now;
          else if (now - alignSinceRef.current >= ALIGN_HOLD_MS) {
            setGuidanceText("Good — hold still. Capturing in…");
            setCountdown(3);
          }
        } else {
          alignSinceRef.current = null;
          setCountdown(null);
        }
      }

      enrollGuideRafRef.current = requestAnimationFrame(tick);
    };

    guideFrameRef.current = 0;
    enrollGuideRafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (enrollGuideRafRef.current) cancelAnimationFrame(enrollGuideRafRef.current);
      enrollGuideRafRef.current = 0;
    };
  }, [step, enrollGuideStarted, multiAdvanced, countdown, enrollProcessing, easyMode]);

  useEffect(() => {
    if (countdown === null || countdown === 0) return;
    const t = window.setTimeout(() => {
      setCountdown((c) => (c === null || c <= 1 ? 0 : c - 1));
    }, COUNTDOWN_STEP_MS);
    return () => clearTimeout(t);
  }, [countdown]);

  const submitSimpleEnrollment = useCallback(async (imageDataUrl: string, showRetryHint = false) => {
    setEnrollProcessing(true);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(stitchRagApiUrl("/api/face/enroll"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          image: imageDataUrl,
          enroll_mode: "simple",
          quality_check: easyMode ? "lenient" : "strict",
        }),
      });
      const { data: raw, parseError } = await readJsonFromResponse(res);
      if (parseError) throw new Error(parseError);
      const data = raw as { ok?: boolean; error?: string; confidence_score?: number };
      if (!res.ok || !data.ok) throw new Error(data.error || res.statusText || `HTTP ${res.status}`);
      setPendingCapture(null);
      setEnrollTestResult(null);
      setEnrollFailCount(0);
      const sc = data.confidence_score;
      setLastEnrollTemplateScore(typeof sc === "number" && !Number.isNaN(sc) ? sc : null);
      setStep("enroll_test");
    } catch (e) {
      if (isNetworkError(e)) {
        setBridgeState("down");
        setError("Cannot reach the bridge while enrolling.");
      } else {
        setEnrollFailCount((n) => n + 1);
        const msg = e instanceof Error ? e.message : String(e);
        setError(
          msg
            ? `${msg}${showRetryHint ? " You can retry with the same capture below." : ""}`
            : "Enrollment failed.",
        );
      }
    } finally {
      setEnrollProcessing(false);
      setBusy(false);
    }
  }, [email, easyMode]);

  useEffect(() => {
    if (countdown !== 0) return;
    if (countdownCaptureDoneRef.current) return;
    const v = videoRef.current;
    if (!v || v.videoWidth < 2) {
      setCountdown(null);
      return;
    }
    countdownCaptureDoneRef.current = true;
    const dataUrl = frameToJpegDataUrl(v, { maxWidth: 640, quality: 0.82 });
    setPendingCapture(dataUrl);
    setCountdown(null);
    setEnrollGuideStarted(false);
    void submitSimpleEnrollment(dataUrl, true);
  }, [countdown, submitSimpleEnrollment]);

  async function retryEnrollmentFromPending() {
    if (!pendingCapture) return;
    await submitSimpleEnrollment(pendingCapture, true);
  }

  async function submitMultiEnrollment() {
    if (multiShots.length < 2) {
      setError("Capture at least two angles.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const maxShots = 5;
      const images = multiShots.length > maxShots ? multiShots.slice(-maxShots) : [...multiShots];
      const res = await fetch(stitchRagApiUrl("/api/face/enroll"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          images,
          enroll_mode: "multi",
          quality_check: easyMode ? "lenient" : "strict",
        }),
      });
      const { data: raw, parseError } = await readJsonFromResponse(res);
      if (parseError) throw new Error(parseError);
      const data = raw as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || res.statusText || `HTTP ${res.status}`);
      setMultiShots([]);
      setEnrollFailCount(0);
      stopCamera();
      setStep("verify");
    } catch (e) {
      if (isNetworkError(e)) {
        setBridgeState("down");
        setError("Cannot reach the bridge while enrolling.");
      } else {
        setEnrollFailCount((n) => n + 1);
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  }

  async function runQuickEnrollTest() {
    const video = videoRef.current;
    if (!video || video.videoWidth < 2) {
      setError("Camera not ready.");
      return;
    }
    setEnrollTestBusy(true);
    setEnrollTestResult(null);
    setError(null);
    const frames: string[] = [];
    const interval = 1000 / 6;
    const start = performance.now();
    while (performance.now() - start < 1500) {
      frames.push(frameToJpegDataUrl(video));
      await new Promise((r) => setTimeout(r, interval));
    }
    const main = frameToJpegDataUrl(video);
    try {
      const res = await fetch(stitchRagApiUrl("/api/face/verify"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          image: main,
          liveness_frames: frames.length ? frames : [main],
          threshold: easyMode ? 0.45 : 0.55,
        }),
      });
      const { data: raw, parseError } = await readJsonFromResponse(res);
      if (parseError) throw new Error(parseError);
      const data = raw as VerifyResponse;
      if (!res.ok && res.status !== 200) {
        throw new Error(data.error || res.statusText || `HTTP ${res.status}`);
      }
      const ok = Boolean(data.verified);
      const conf = data.confidence ?? 0;
      setEnrollTestResult({
        ok,
        confidence: conf,
        detail: data.liveness_detail || (ok ? "Match" : data.error || "No match"),
      });
    } catch (e) {
      setEnrollTestResult({
        ok: false,
        confidence: 0,
        detail: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setEnrollTestBusy(false);
    }
  }

  async function submitEmail() {
    const em = email.trim();
    if (!em) {
      setError("Enter your email.");
      return;
    }
    if (bridgeState !== "up") {
      setError("Bridge is offline — start stitch_rag_bridge.py or click Retry.");
      return;
    }
    setBusy(true);
    setError(null);
    livenessFailRef.current = 0;
    setLivenessFails(0);
    try {
      const res = await fetch(stitchRagApiUrl(`/api/face/status?email=${encodeURIComponent(em)}`));
      const { data: raw, parseError } = await readJsonFromResponse(res);
      if (parseError) throw new Error(parseError);
      const data = raw as FaceStatus;
      if (!res.ok || !data.ok) throw new Error(data.error || res.statusText || `HTTP ${res.status}`);
      if (purpose === "purchase") {
        setStep(data.enrolled ? "verify" : "purchase_need_enroll");
      } else {
        setStep(data.enrolled ? "verify" : "enroll");
      }
    } catch (e) {
      if (isNetworkError(e)) {
        setBridgeState("down");
        setError("Cannot reach the bridge — is stitch_rag_bridge.py running on port 8765?");
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  }

  async function runVerification() {
    const video = videoRef.current;
    if (!video || video.videoWidth < 2) {
      setError("Camera not ready.");
      return;
    }
    setBusy(true);
    setError(null);
    setLiveDetail(null);
    setConfidence(0);

    const frames: string[] = [];
    const interval = 1000 / LIVENESS_FPS;
    const start = performance.now();
    while (performance.now() - start < LIVENESS_DURATION_MS) {
      frames.push(frameToJpegDataUrl(video));
      await new Promise((r) => setTimeout(r, interval));
    }
    const main = frameToJpegDataUrl(video);

    try {
      const res = await fetch(stitchRagApiUrl("/api/face/verify"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          image: main,
          liveness_frames: frames,
          threshold: easyMode ? 0.48 : 0.6,
        }),
      });
      const { data: raw, parseError } = await readJsonFromResponse(res);
      if (parseError) throw new Error(parseError);
      const data = raw as VerifyResponse;
      if (!res.ok && res.status !== 200) {
        throw new Error(data.error || res.statusText || `HTTP ${res.status}`);
      }
      setConfidence(data.confidence ?? 0);
      setLiveDetail(data.liveness_detail ?? null);

      if (data.verified) {
        sessionStorage.setItem(SESSION_VERIFIED_KEY, email.trim());
        livenessFailRef.current = 0;
        stopCamera();
        if (purpose === "purchase" && onPurchaseVerified) {
          onPurchaseVerified();
          return;
        }
        setStep("success");
        return;
      }

      if (!data.liveness_passed) {
        livenessFailRef.current += 1;
        setLivenessFails(livenessFailRef.current);
        setLivenessHint("Please blink — I need to see you're real. Or slowly turn your head left and right.");
        if (livenessFailRef.current >= 2) {
          setLivenessHint("Liveness is still failing — try Run check again with clearer lighting and slower blinks.");
        }
      } else if (!data.match) {
        setLivenessHint("Face match was weak — try Run check again.");
      }
    } catch (e) {
      if (isNetworkError(e)) {
        setBridgeState("down");
        setError("Cannot reach the bridge during verification.");
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (step !== "verify" && step !== "enroll" && step !== "enroll_test") return;
    if (bridgeState !== "up") return;
    void startCamera();
    return () => {
      stopCamera();
    };
  }, [step, bridgeState, cameraDeviceId, startCamera, stopCamera]);

  useEffect(() => {
    if (step !== "enroll") {
      setEnrollGuideStarted(false);
      setCountdown(null);
      setPendingCapture(null);
      setEnrollQualityPct(0);
      alignSinceRef.current = null;
      countdownCaptureDoneRef.current = false;
    }
  }, [step]);

  const busyRef = useRef(false);
  busyRef.current = busy;
  const verifyDeadlineRef = useRef<number>(0);
  useEffect(() => {
    if (step !== "verify") return;
    verifyDeadlineRef.current = Date.now() + VERIFY_TIMEOUT_MS;
    let disposed = false;
    const t = window.setInterval(() => {
      if (disposed) return;
      if (Date.now() > verifyDeadlineRef.current && !busyRef.current) {
        disposed = true;
        window.clearInterval(t);
        setError("This verify step timed out — tap Run check again when ready.");
        verifyDeadlineRef.current = Number.MAX_SAFE_INTEGER;
        stopCamera();
      }
    }, 1000);
    return () => {
      disposed = true;
      window.clearInterval(t);
    };
  }, [step, email, initialEmail, stopCamera]);

  const captureReadyThreshold = easyMode ? ENROLL_CAPTURE_QUALITY_READY_EASY : ENROLL_CAPTURE_QUALITY_READY_STRICT;
  const ringClass =
    ovalGood && enrollQualityPct >= captureReadyThreshold
      ? "border-2 border-stitch-primary-container neo-shadow-sm"
      : "border-2 border-stitch-surface-secondary neo-shadow-sm";

  const panelTitle = purpose === "purchase" ? "Verify to approve this payment" : "Face verification (local)";

  return (
    <section className="noir-card p-4 font-body text-stitch-heading md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-display text-lg font-semibold leading-snug tracking-[-0.02em] text-stitch-heading">
            {panelTitle}
          </p>
          {import.meta.env.DEV ? (
            <p className="mt-1 text-[9px] font-display font-bold uppercase tracking-[0.14em] text-stitch-muted">
              Noir face panel · run <code className="text-stitch-text">npm run sync:stitch</code> if this banner is missing after editing{" "}
              <code className="text-stitch-text">integrations/stitch</code>
            </p>
          ) : null}
          {purpose === "purchase" && purchaseSubtitle ? (
            <p className="mt-1 text-sm text-stitch-text">{purchaseSubtitle}</p>
          ) : null}
        </div>
        {purpose === "purchase" && onPurchaseCancel ? (
          <button
            type="button"
            onClick={onPurchaseCancel}
            className="shrink-0 rounded-sm border-2 border-black bg-stitch-elevated px-3 py-1.5 font-body text-xs font-semibold text-stitch-heading neo-shadow-sm hover:bg-stitch-variant active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
          >
            Cancel
          </button>
        ) : null}
      </div>

      {bridgeState === "checking" ? (
        <p className="mt-3 text-sm text-stitch-text">Checking local bridge (/health)…</p>
      ) : null}

      {bridgeState === "down" ? (
        <div className="mt-3 rounded-sm border-2 border-amber-500/40 bg-stitch-surface-low p-3 font-body text-sm text-amber-100 neo-shadow-sm">
          <p className="font-semibold text-amber-50">Bridge not reachable</p>
          <p className="mt-1 text-xs leading-relaxed text-amber-100/90">
            You need <strong className="text-stitch-heading">two</strong> processes: (1) Flask bridge in{" "}
            <code className="rounded-sm border-2 border-stitch-surface-secondary bg-stitch-surface-lowest px-1 text-amber-200">cursor_linkup_mcp</code>:{" "}
            <code className="rounded-sm border-2 border-stitch-surface-secondary bg-stitch-surface-lowest px-1 text-amber-200">.\.venv\Scripts\python.exe stitch_rag_bridge.py</code>{" "}
            (<code className="rounded-sm border-2 border-stitch-surface-secondary bg-stitch-surface-lowest px-1 text-amber-200">127.0.0.1:8765</code>). (2) Vite dev server for Stitch desktop (e.g.{" "}
            <code className="rounded-sm border-2 border-stitch-surface-secondary bg-stitch-surface-lowest px-1 text-amber-200">npm run dev:browser</code>, default{" "}
            <code className="rounded-sm border-2 border-stitch-surface-secondary bg-stitch-surface-lowest px-1 text-amber-200">http://localhost:1420</code>) so{" "}
            <code className="rounded-sm border-2 border-stitch-surface-secondary bg-stitch-surface-lowest px-1 text-amber-200">/api</code> is proxied to 8765. &apos;Failed to fetch&apos; with the bridge running
            usually means Vite is not running or you opened the app outside that dev URL.
          </p>
          <button
            type="button"
            className={`mt-2 ${btnPrimary}`}
            onClick={() => void checkBridge()}
          >
            Retry connection
          </button>
          {error ? <p className="mt-2 text-xs text-amber-200">{error}</p> : null}
        </div>
      ) : null}

      {bridgeState === "up" ? (
        <>
          {navigator.mediaDevices &&
          (step === "enroll" || step === "enroll_test" || step === "verify") ? (
            <div className="mt-3 rounded-sm border-2 border-black bg-stitch-card px-3 py-2 neo-shadow-sm">
              <p className="font-display text-[10px] font-bold uppercase tracking-[0.08em] text-stitch-text">Camera</p>
              <p className="mt-1 font-body text-[10px] leading-snug text-stitch-muted">
                Choose which lens feeds enrollment and verification. Names may stay generic until you use{" "}
                <strong className="text-stitch-heading">Refresh names</strong> once.
              </p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
                <label className="min-w-0 flex-1 font-body text-[10px] text-stitch-text">
                  <span className="mb-0.5 block text-stitch-muted">Video input</span>
                  <select
                    className="mt-0.5 w-full max-w-full truncate rounded-sm border-2 border-black bg-stitch-surface-lowest px-2 py-1.5 font-body text-[11px] text-stitch-heading outline-none focus:border-stitch-primary-container"
                    value={videoInputs.some((d) => d.deviceId === cameraDeviceId) ? cameraDeviceId : ""}
                    disabled={busy}
                    onChange={(e) => {
                      const v = e.target.value;
                      setCameraDeviceId(v);
                      writeFaceCameraLs(v);
                    }}
                  >
                    <option value="">System default (front camera hint)</option>
                    {videoInputs.map((d) => (
                      <option key={`cam-${d.deviceId}`} value={d.deviceId}>
                        {videoDeviceOptionLabel(d)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={busy || cameraListBusy}
                  onClick={() => void relistVideoDevices(true)}
                  className="shrink-0 rounded-sm border-2 border-black bg-stitch-elevated px-3 py-1.5 font-body text-[11px] font-semibold text-stitch-heading neo-shadow-sm hover:bg-stitch-variant disabled:opacity-50"
                >
                  {cameraListBusy ? "…" : "Refresh names"}
                </button>
              </div>
              {cameraListNote ? <p className="mt-2 font-body text-[10px] text-amber-200/95">{cameraListNote}</p> : null}
            </div>
          ) : null}

          {step === "enroll" || step === "enroll_test" || step === "verify" ? (
            <div className="mt-3 rounded-sm border-2 border-black bg-stitch-card px-3 py-3 neo-shadow-sm">
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={easyMode}
                  onClick={() => setEasyMode((v) => !v)}
                  className={`relative mt-0.5 inline-flex h-7 w-11 shrink-0 items-center rounded-full border-2 px-0.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stitch-primary-container ${
                    easyMode
                      ? "justify-end border-black bg-stitch-primary-container neo-shadow-sm"
                      : "justify-start border-stitch-surface-secondary bg-stitch-surface-low neo-shadow-sm"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 rounded-full ${
                      easyMode ? "bg-black" : "bg-stitch-variant"
                    }`}
                  />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-xs font-bold uppercase tracking-[0.05em] text-stitch-primary">
                    ✨ Easy Mode
                  </p>
                  <p className="mt-1 font-body text-[11px] leading-relaxed text-stitch-text">
                    Lower detector threshold, friendlier guidance, and after two failed enrolls you can skip in one tap
                    (presentations).
                  </p>
                  {!easyMode ? (
                    <p className="mt-1.5 font-body text-[10px] leading-relaxed text-stitch-text">
                      <span className="font-semibold text-stitch-heading">Strict:</span> tighter framing, higher match bar,
                      stricter server-side detection.
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {purpose === "settings" ? (
            <ul className="mt-2 list-inside list-disc font-body text-[11px] leading-relaxed text-stitch-text">
              <li>This is a demo of face verification — not high-security authentication.</li>
              <li>
                The moving box is a <strong className="text-stitch-heading">generic human-face hint</strong> (MediaPipe) with extra
                shape/score gates to cut pet false alarms — not who Stitch thinks you are. Turn <strong className="text-stitch-heading">Easy Mode</strong>{" "}
                off for the strictest overlay. <strong className="text-stitch-heading">Run check</strong> compares live video to your enrolled templates.
              </li>
              <li>Your face data stays on this device (encrypted under ~/.stitch/face_db/), never uploaded by this bridge.</li>
              <li>Allow camera and mic in the browser when prompted.</li>
            </ul>
          ) : (
            <p className="mt-2 font-body text-[11px] leading-relaxed text-stitch-text">
              Uses the same local bridge as Settings. Retry Run check or adjust lighting if verification fails.
            </p>
          )}

          {purpose === "purchase" && !initialEmail.trim() ? (
            <div className="mt-4 rounded-sm border-2 border-amber-500/40 bg-stitch-surface-low p-3 font-body text-sm text-amber-100 neo-shadow-sm">
              <p className="font-semibold text-amber-50">Account email required</p>
              <p className="mt-1 text-xs leading-relaxed text-amber-100/90">
                Save your email in <strong className="text-stitch-heading">Settings</strong> (demo auth), enroll your face there, then approve this payment again.
              </p>
            </div>
          ) : null}

          {step === "email" && purpose === "settings" ? (
            <div className="mt-4 space-y-2">
              <label className="block font-display text-xs font-bold uppercase tracking-[0.05em] text-stitch-text">
                Step 1 — Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="mt-1 w-full rounded-sm border-2 border-black bg-stitch-surface-lowest px-3 py-2 font-body text-sm text-stitch-heading placeholder:text-stitch-muted focus:border-stitch-primary-container focus:outline-none"
                />
              </label>
              <p className="font-body text-[11px] text-stitch-text">
                If you already set <strong>Account email</strong> above, you can still confirm or change it here.
              </p>
              {error ? <p className="font-body text-xs text-stitch-error">{error}</p> : null}
              <button
                type="button"
                disabled={busy}
                onClick={() => void submitEmail()}
                className={btnPrimary}
              >
                {busy ? "Checking…" : "Continue"}
              </button>
            </div>
          ) : null}

          {purpose === "purchase" && initialEmail.trim() && step === "email" && busy ? (
            <p className="mt-4 font-body text-sm text-stitch-text">Checking face enrollment…</p>
          ) : null}

          {step === "purchase_need_enroll" ? (
            <div className="mt-4 rounded-sm border-2 border-black bg-stitch-card p-4 neo-shadow-sm">
              <p className="font-body text-sm font-semibold text-stitch-heading">No face on file for this email</p>
              <p className="mt-2 font-body text-xs leading-relaxed text-stitch-text">
                Open <strong>Settings</strong>, confirm your account email, complete <strong>Face verification</strong> enrollment, then return here and tap Approve again.
              </p>
            </div>
          ) : null}

          {step === "enroll" ? (
            <div className="mt-4 space-y-3">
              <p className="font-body text-sm font-medium text-stitch-heading">Enroll — {email}</p>
              <p className="font-body text-[10px] leading-snug text-stitch-muted">
                The live outline is a <strong className="text-stitch-heading">human-face detector</strong>, not proof the frame is you.
                We hide very weak matches to cut down pet false alarms; enrollment still uses the frame you capture after the countdown.
              </p>
              <p className="font-body text-xs text-stitch-text">
                One guided capture: align in the oval, then we save a few augmented templates from that frame (like Face ID). This may take a few seconds while embeddings generate.
              </p>
              <p className="rounded-sm border-2 border-black bg-stitch-surface-low px-3 py-2 font-body text-[11px] leading-relaxed text-stitch-heading neo-shadow-sm">
                <span className="font-display text-[10px] font-bold uppercase tracking-[0.05em] text-stitch-primary-container">
                  Pro tip
                </span>
                <span className="mt-1 block italic text-stitch-primary">
                  Center face, good lighting, natural blink
                </span>
                <span className="mt-1 block not-italic text-stitch-text">
                  Then hold steady for the countdown (Easy Mode on by default).
                </span>
              </p>

              <label className="flex cursor-pointer items-center gap-2 font-body text-[11px] text-stitch-text">
                <input type="checkbox" checked={multiAdvanced} onChange={(e) => setMultiAdvanced(e.target.checked)} />
                Advanced: multi-angle capture (legacy)
              </label>

              {!multiAdvanced ? (
                <>
                  {!enrollGuideStarted && !enrollProcessing ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setError(null);
                        countdownCaptureDoneRef.current = false;
                        setLastEnrollTemplateScore(null);
                        setEnrollFailCount(0);
                        setEnrollGuideStarted(true);
                        setGuidanceText(easyMode ? "Center face, good lighting, natural blink." : "Center your face in the oval.");
                        alignSinceRef.current = null;
                      }}
                      className={btnPrimary}
                    >
                      Start enrollment
                    </button>
                  ) : null}

                  <div className={`relative mx-auto aspect-video w-full max-w-md overflow-hidden rounded-sm bg-black/90 ${ringClass}`}>
                    <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
                    <FaceHudCorners active={ovalGood && enrollQualityPct >= captureReadyThreshold} />
                    <svg
                      className="pointer-events-none absolute inset-0 h-full w-full"
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
                    >
                      <ellipse
                        cx={OVAL.cx}
                        cy={OVAL.cy}
                        rx={OVAL.rx}
                        ry={OVAL.ry}
                        fill="none"
                        stroke={
                          ovalGood && enrollQualityPct >= captureReadyThreshold
                            ? "color-mix(in srgb, var(--stitch-primary-container) 95%, transparent)"
                            : "color-mix(in srgb, var(--stitch-outline) 45%, transparent)"
                        }
                        strokeWidth="1.2"
                      />
                    </svg>
                    {faceBox ? (
                      <FaceHudBoundingBox
                        faceBox={faceBox}
                        metrics={faceHudMetrics}
                        tone={ovalGood && enrollQualityPct >= captureReadyThreshold ? "good" : "muted"}
                      />
                    ) : null}
                    {countdown !== null && countdown > 0 ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/55">
                        <span className="font-display text-6xl font-bold tracking-tight text-stitch-primary">
                          {countdown}
                        </span>
                      </div>
                    ) : null}
                  </div>

                  {enrollGuideStarted || enrollProcessing ? (
                    <div className="rounded-sm border-2 border-black bg-stitch-card p-3 neo-shadow-sm">
                      <p
                        className={`font-body text-xs font-medium leading-relaxed text-stitch-heading ${
                          easyMode ? "italic text-stitch-primary" : ""
                        }`}
                      >
                        {guidanceText}
                      </p>
                      <div className="mt-2 h-2 w-full overflow-hidden rounded-sm bg-stitch-elevated">
                        <div
                          className="h-full rounded-sm bg-stitch-primary-container transition-all"
                          style={{ width: `${enrollQualityPct}%` }}
                        />
                      </div>
                      <p className="mt-1 font-body text-[11px] text-stitch-text">
                        {easyMode
                          ? "Match quality (how ready we are to capture): "
                          : "Match quality (capture readiness, 0–100%): "}
                        {enrollQualityPct}%
                      </p>
                    </div>
                  ) : null}

                  {enrollProcessing ? (
                    <p className="font-body text-xs text-stitch-text">Saving face templates… this may take a few seconds.</p>
                  ) : null}

                  {pendingCapture && error ? (
                    <div className="space-y-2 rounded-sm border-2 border-amber-500/40 bg-stitch-surface-low p-3 neo-shadow-sm">
                      <p className="font-body text-xs text-amber-100">{error}</p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void retryEnrollmentFromPending()}
                          className={btnPrimary}
                        >
                          Retry embedding with same capture
                        </button>
                        {enrollFailCount >= 2 && easyMode ? (
                          <button
                            type="button"
                            onClick={skipForDemoAfterFailedEnrolls}
                            className={btnOutlineElectric}
                          >
                            Skip for demo
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <p className="font-body text-[11px] text-stitch-text">
                    Capture 2–3 angles; up to five images are sent. Respects Easy Mode (lenient vs strict server detection).
                  </p>
                  <div className="relative mx-auto aspect-video w-full max-w-md overflow-hidden rounded-sm border-2 border-stitch-surface-secondary bg-black/90 neo-shadow-sm">
                    <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
                    <FaceHudCorners active={Boolean(faceBox)} />
                    {faceBox ? (
                      <FaceHudBoundingBox faceBox={faceBox} metrics={faceHudMetrics} tone="hot" />
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy || !videoRef.current}
                      onClick={() => {
                        const v = videoRef.current;
                        if (!v) return;
                        setMultiShots((s) => [...s, frameToJpegDataUrl(v, { maxWidth: 480, quality: 0.72 })]);
                      }}
                      className={btnPrimary}
                    >
                      Capture angle
                    </button>
                    <button
                      type="button"
                      disabled={busy || multiShots.length < 2}
                      onClick={() => void submitMultiEnrollment()}
                      className={btnPrimary}
                    >
                      {busy ? "Saving…" : "Save enrollment (multi)"}
                    </button>
                  </div>
                </>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    stopCamera();
                    sessionStorage.setItem(SESSION_FACE_SETUP_SKIPPED_KEY, "1");
                    setFaceSkippedDemo(true);
                    setError(null);
                    setStep("success");
                  }}
                  className={btnOutline}
                >
                  Skip face setup (demo)
                </button>
              </div>
              {error && !pendingCapture ? (
                <div className="space-y-2">
                  <p className="font-body text-xs text-stitch-error">{error}</p>
                  {enrollFailCount >= 2 && easyMode ? (
                    <button
                      type="button"
                      onClick={skipForDemoAfterFailedEnrolls}
                      className={btnOutlineElectric}
                    >
                      Skip for demo
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {step === "enroll_test" ? (
            <div className="mt-4 space-y-3">
              <p className="font-body text-sm font-semibold text-stitch-success">Face saved</p>
              <p className="font-body text-xs text-stitch-text">
                Test that the camera recognizes you before continuing to full verification.
              </p>
              {lastEnrollTemplateScore != null ? (
                <div className="rounded-sm border-2 border-black bg-stitch-card p-3 neo-shadow-sm">
                  <p className="font-display text-[11px] font-bold uppercase tracking-[0.05em] text-stitch-text">
                    Enrollment template quality
                  </p>
                  <p className="mt-0.5 font-body text-[10px] text-stitch-text">
                    Server-side 0–100% match quality across saved templates (higher is more consistent).
                  </p>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-sm bg-stitch-elevated">
                    <div
                      className="h-full rounded-sm bg-stitch-primary-container transition-all"
                      style={{ width: `${Math.min(100, lastEnrollTemplateScore)}%` }}
                    />
                  </div>
                  <p className="mt-1 font-body text-xs font-medium text-stitch-text">
                    {lastEnrollTemplateScore.toFixed(0)}%
                  </p>
                </div>
              ) : null}
              <div className="relative mx-auto aspect-video w-full max-w-md overflow-hidden rounded-sm border-2 border-stitch-surface-secondary bg-black/90 neo-shadow-sm">
                <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
                <FaceHudCorners active={false} />
              </div>
              <button
                type="button"
                disabled={enrollTestBusy}
                onClick={() => void runQuickEnrollTest()}
                className={btnPrimary}
              >
                {enrollTestBusy ? "Verifying…" : "Test verification"}
              </button>
              {enrollTestResult ? (
                <div
                  className={`rounded-sm border-2 p-3 font-body text-sm neo-shadow-sm ${enrollTestResult.ok ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-100" : "border-rose-500/40 bg-rose-950/40 text-rose-100"}`}
                >
                  {enrollTestResult.ok ? (
                    <p>
                      Match — {(enrollTestResult.confidence * 100).toFixed(0)}% confidence. {enrollTestResult.detail}
                    </p>
                  ) : (
                    <p>
                      No match — {(enrollTestResult.confidence * 100).toFixed(0)}% confidence. {enrollTestResult.detail}
                    </p>
                  )}
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  stopCamera();
                  setStep("verify");
                }}
                className={btnPrimary}
              >
                Continue to sign-in verification
              </button>
              {error ? <p className="font-body text-xs text-stitch-error">{error}</p> : null}
            </div>
          ) : null}

          {step === "verify" ? (
            <div className="mt-4 space-y-3">
              <p className="font-body text-sm font-medium text-stitch-heading">Verify — {email}</p>
              <p className="font-body text-[10px] leading-snug text-stitch-muted">
                The outline on the video is only a <strong className="text-stitch-heading">human-face detector</strong> (pets can
                sometimes trigger it). Your account email is shown in the title above — it is{" "}
                <strong className="text-stitch-heading">not</strong> inferred from the camera. Identity uses{" "}
                <strong className="text-stitch-heading">Run check</strong> against templates you enrolled.
              </p>
              {easyMode ? (
                <p className="font-body text-xs italic leading-relaxed text-stitch-primary">
                  Center face, good lighting, natural blink — then run the check.
                </p>
              ) : null}
              <p className="font-body text-xs text-amber-200/95">{livenessHint}</p>
              <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-start sm:justify-center">
                <div
                  className={`relative mx-auto aspect-video w-full max-w-md shrink-0 overflow-hidden rounded-sm bg-black/90 ${
                    faceBox ? "border-2 border-stitch-primary-container neo-shadow-sm" : "border-2 border-stitch-surface-secondary neo-shadow-sm"
                  }`}
                >
                  <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
                  <FaceHudCorners active={Boolean(faceBox)} />
                  {faceBox ? (
                    <FaceHudBoundingBox faceBox={faceBox} metrics={faceHudMetrics} tone="hot" />
                  ) : null}
                </div>
                <div className="flex flex-col items-center gap-2 rounded-sm border-2 border-black bg-stitch-card px-4 py-3 neo-shadow-sm sm:min-w-[120px]">
                  <CircularConfidenceMeter value01={confidence} label="Match confidence" />
                  <p className="font-body text-[11px] font-medium text-stitch-text">
                    Pass bar ~{easyMode ? 48 : 60}%
                  </p>
                  {liveDetail ? <p className="max-w-[220px] text-center font-body text-[11px] text-stitch-text">{liveDetail}</p> : null}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void runVerification()}
                  className={btnPrimary}
                >
                  {busy ? "Verifying…" : "Run check (~2.5s capture)"}
                </button>
              </div>
              {error ? <p className="font-body text-xs text-stitch-error">{error}</p> : null}
            </div>
          ) : null}

          {step === "success" && purpose === "settings" ? (
            <div className="mt-4 rounded-sm border-2 border-emerald-500/35 bg-emerald-950/40 p-3 font-body text-sm text-emerald-50 neo-shadow-sm">
              {faceSkippedDemo ? (
                <p>Face enrollment was skipped (demo). You can enroll later from this panel.</p>
              ) : (
                <p>Verified for this session. You can return to the dashboard.</p>
              )}
              <button
                type="button"
                className={`mt-2 block ${btnPrimary}`}
                onClick={() => {
                  bootstrapRef.current = false;
                  stopCamera();
                  const skipped = faceSkippedDemo;
                  setFaceSkippedDemo(false);
                  if (skipped) {
                    setStep(initialEmail.trim() || email.trim() ? "enroll" : "email");
                    return;
                  }
                  if (initialEmail.trim()) {
                    setEmail(initialEmail.trim());
                    setStep("verify");
                  } else {
                    setStep("email");
                  }
                }}
              >
                Done
              </button>
            </div>
          ) : null}

        </>
      ) : null}
    </section>
  );
}
