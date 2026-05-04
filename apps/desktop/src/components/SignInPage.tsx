import { type FormEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  authHeaders,
  readJsonFromResponse,
  readSessionId,
  stitchPreferSameWindowGoogleOAuth,
  stitchRagApiUrl,
  writeDemoMagicAuth,
  writeSessionId,
  writeUserEmail,
} from "../lib/stitchBridge";

export type SignInCompletionMode = "google" | "demo";

export type SignInPageProps = {
  /** `google` after OAuth popup success; `demo` after magic-link (hackathon) path. */
  onSignedIn: (mode?: SignInCompletionMode) => void | Promise<void>;
  onToast?: (message: string) => void;
};

function GoogleGlyph() {
  return (
    <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

export function SignInPage({ onSignedIn, onToast }: SignInPageProps) {
  const [sessionId, setSessionId] = useState(readSessionId);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [magicSending, setMagicSending] = useState(false);
  const [oauthMessage, setOauthMessage] = useState<string | null>(null);
  const [bridgeHasGoogle, setBridgeHasGoogle] = useState<boolean | null>(null);
  const popupPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function clearPopupPoll() {
    if (popupPollRef.current) {
      window.clearInterval(popupPollRef.current);
      popupPollRef.current = null;
    }
  }

  useLayoutEffect(() => {
    const root = document.documentElement;
    const prev = root.dataset.theme ?? "dark";
    root.dataset.theme = "dark";
    root.style.colorScheme = "dark";
    return () => {
      root.dataset.theme = prev;
      root.style.colorScheme = prev === "light" ? "light" : "dark";
    };
  }, []);

  /** Demo flag must not skip this page on reload; clear stale value when landing on sign-in. */
  useEffect(() => {
    writeDemoMagicAuth(false);
  }, []);

  useEffect(() => () => clearPopupPoll(), []);

  const refreshAfterOAuth = useCallback(() => {
    setSessionId(readSessionId());
    void Promise.resolve(onSignedIn("google"));
  }, [onSignedIn]);

  useEffect(() => {
    void (async () => {
      const res = await fetch(stitchRagApiUrl("/api/health"));
      const { data, parseError } = await readJsonFromResponse(res);
      if (!parseError && data && typeof data === "object" && "google_oauth" in data) {
        setBridgeHasGoogle(Boolean((data as { google_oauth?: boolean }).google_oauth));
      } else {
        setBridgeHasGoogle(false);
      }
    })();
  }, []);

  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      if (ev.data?.type !== "stitch-google-oauth") return;
      clearPopupPoll();
      setLoading(false);
      const p = ev.data.payload as { ok?: boolean; session_id?: string; email?: string; error?: string; detail?: string };
      if (!p?.ok) {
        const err = p.error === "access_denied" ? "Sign-in cancelled or permission denied." : p.error || p.detail || "Google sign-in failed.";
        setOauthMessage(err);
        return;
      }
      if (p.session_id) {
        writeSessionId(p.session_id);
        setOauthMessage(null);
        setLoading(false);
        if (p.email) writeUserEmail(p.email);
        refreshAfterOAuth();
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [refreshAfterOAuth]);

  async function startGoogle() {
    setOauthMessage(null);
    setLoading(true);
    try {
      const origin = window.location.origin;
      const res = await fetch(stitchRagApiUrl("/api/auth/google/url"), {
        method: "POST",
        headers: { ...authHeaders(sessionId || null), "Content-Type": "application/json" },
        body: JSON.stringify({ client_origin: origin }),
      });
      const { data, parseError } = await readJsonFromResponse(res);
      if (parseError) {
        setOauthMessage(parseError);
        setLoading(false);
        return;
      }
      const d = data as { ok?: boolean; auth_url?: string; error?: string };
      if (!res.ok || !d.ok || !d.auth_url) {
        setOauthMessage(d.error || `Could not start Google sign-in (${res.status}).`);
        setLoading(false);
        return;
      }
      if (stitchPreferSameWindowGoogleOAuth()) {
        window.location.assign(d.auth_url);
        return;
      }
      // Do not use noopener: OAuth callback uses window.opener.postMessage to this window.
      const w = window.open(d.auth_url, "stitch_google_oauth", "width=520,height=720");
      if (!w) {
        window.location.assign(d.auth_url);
        return;
      }
      setOauthMessage("Complete sign-in in the popup…");
      clearPopupPoll();
      popupPollRef.current = window.setInterval(() => {
        try {
          if (w.closed) {
            clearPopupPoll();
            setLoading(false);
            setOauthMessage((msg) =>
              msg === "Complete sign-in in the popup…" ? "Sign-in window closed before finishing. Try again." : msg,
            );
          }
        } catch {
          clearPopupPoll();
          setLoading(false);
        }
      }, 500);
    } catch {
      setOauthMessage("Network error — is stitch_rag_bridge.py running?");
      setLoading(false);
    }
  }

  function onMagicSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes("@")) {
      setOauthMessage("Enter a valid institutional email.");
      return;
    }
    setMagicSending(true);
    setOauthMessage(null);
    writeUserEmail(trimmed);
    writeDemoMagicAuth(true);
    onToast?.("Magic link sent (demo). Opening command center…");
    window.setTimeout(() => {
      setMagicSending(false);
      void Promise.resolve(onSignedIn("demo"));
    }, 450);
  }

  return (
    <div className="relative min-h-[100dvh] w-full overflow-x-hidden bg-transparent text-stitch-text">
      <div className="relative z-10 mx-auto flex min-h-[100dvh] max-w-[480px] flex-col px-5 py-10 pb-8">
        <header className="flex flex-col items-center text-center">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-sm border-2 border-black bg-stitch-primary-container shadow-[4px_4px_0_0_#000]"
            aria-hidden
          >
            <span className="material-symbols-outlined text-[34px] leading-none text-stitch-on-primary-fixed">token</span>
          </div>
          <h1 className="mt-6 font-display text-4xl font-bold italic tracking-tight text-stitch-primary-container md:text-5xl">
            STITCH
          </h1>
          <p className="mt-3 max-w-sm font-body text-sm leading-relaxed text-stitch-muted">
            Securely manage your subscription infrastructure.
          </p>
        </header>

        <div className="relative mt-10">
          <div
            className="pointer-events-none absolute -right-1 -top-1 z-20 h-12 w-12 border-b-2 border-l-2 border-black bg-stitch-variant shadow-[-3px_3px_0_0_#000]"
            style={{ clipPath: "polygon(0 0, 100% 0, 100% 100%)" }}
            aria-hidden
          />
          <div className="neo-card relative z-10 overflow-hidden p-6 pt-7">
            <div className="pointer-events-none absolute bottom-0 right-0 z-0 h-10 w-10 border-l-2 border-t-2 border-black/40 bg-stitch-surface-lowest/80" aria-hidden />
            <p className="label-caps text-stitch-heading">Authentication required</p>
            <h2 className="mt-1 font-display text-xl font-bold uppercase tracking-tight text-stitch-heading">Command Center Login</h2>

            {bridgeHasGoogle === false ? (
              <p className="mt-4 rounded-sm border-2 border-black bg-stitch-warning/15 p-3 font-body text-[11px] leading-relaxed text-stitch-warning">
                Google OAuth is not configured on the bridge yet. Add keys to <code className="font-mono text-stitch-heading">.env</code> and
                restart, or use the email path for demo access.
              </p>
            ) : null}

            <div className="mt-6">
              <button
                type="button"
                disabled={loading || bridgeHasGoogle === false}
                onClick={() => void startGoogle()}
                className="neo-button-primary flex w-full items-center justify-center gap-3 px-4 py-4 font-display text-sm uppercase tracking-wide"
              >
                <GoogleGlyph />
                {loading ? "Connecting…" : "Sign in with Google"}
              </button>
            </div>

            {oauthMessage ? (
              <p className="mt-4 whitespace-pre-wrap rounded-sm border-2 border-black bg-stitch-card px-3 py-2 font-body text-[11px] text-stitch-warning">
                {oauthMessage}
              </p>
            ) : null}

            <div className="mt-8 flex items-center gap-3">
              <div className="h-0 flex-1 border-t-2 border-black" aria-hidden />
              <span className="label-caps shrink-0 text-[9px] text-stitch-muted">Or access via email</span>
              <div className="h-0 flex-1 border-t-2 border-black" aria-hidden />
            </div>

            <form className="mt-6 space-y-4" onSubmit={onMagicSubmit}>
              <label className="block">
                <span className="label-caps text-stitch-heading">Institutional Email</span>
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  spellCheck={false}
                  value={email}
                  onChange={(ev) => setEmail(ev.target.value)}
                  placeholder="name@enterprise.com"
                  className="mt-2 w-full border-2 border-black bg-stitch-surface-lowest p-4 font-body text-sm text-stitch-heading placeholder:text-stitch-placeholder"
                />
              </label>
              <button
                type="submit"
                disabled={magicSending}
                className="w-full border-2 border-black bg-stitch-elevated py-3 font-display text-xs font-bold uppercase tracking-wide text-stitch-heading shadow-[4px_4px_0_0_#000] transition hover:bg-zinc-900 active:bg-zinc-950 disabled:opacity-50"
              >
                {magicSending ? "Sending…" : "Send Magic Link"}
              </button>
            </form>
          </div>
        </div>

        <div
          className="pointer-events-none relative mt-8 h-12 w-full overflow-hidden rounded-sm border-2 border-black bg-stitch-elevated opacity-90"
          aria-hidden
        />

        <footer className="mt-auto pt-10 text-center">
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 font-body text-[11px] font-semibold text-stitch-muted">
            <a href="#" className="underline decoration-stitch-border underline-offset-2 hover:text-stitch-heading">
              Privacy Policy
            </a>
            <span className="text-stitch-variant" aria-hidden>
              ·
            </span>
            <a href="#" className="underline decoration-stitch-border underline-offset-2 hover:text-stitch-heading">
              Terms of Service
            </a>
          </div>
          <p className="mt-3 font-mono text-[10px] text-zinc-500">© 2024 Stitch Infrastructure. Node: US-EAST-1</p>
        </footer>
      </div>
    </div>
  );
}
