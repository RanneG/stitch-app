import { useCallback, useEffect, useMemo, useState } from "react";
import {
  authHeaders,
  readJsonFromResponse,
  readSessionId,
  stitchFetch,
  stitchPreferSameWindowGoogleOAuth,
  writeDemoMagicAuth,
  writeSessionId,
} from "../lib/stitchBridge";

type Account = { id: number; email: string; pictureUrl?: string | null };

type Props = {
  onLinkedEmail: (email: string) => void;
  /** Called when session is created, cleared, or invalidated (reload subscriptions, etc.). */
  onAuthSessionChange?: () => void;
};

export function GoogleSignInPanel({ onLinkedEmail, onAuthSessionChange }: Props) {
  const [sessionId, setSessionId] = useState(readSessionId);
  const [bridgeHasGoogle, setBridgeHasGoogle] = useState<boolean | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeEmail, setActiveEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [oauthMessage, setOauthMessage] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    const sid = readSessionId();
    setSessionId(sid);
    if (!sid) {
      setAccounts([]);
      setActiveEmail(null);
      return;
    }
    const res = await stitchFetch("/api/auth/status", { headers: authHeaders(sid) });
    const { data, parseError } = await readJsonFromResponse(res);
    if (parseError) return;
    const d = data as {
      authenticated?: boolean;
      accounts?: Account[];
      activeEmail?: string | null;
      invalidSession?: boolean;
    };
    if (d.invalidSession || !d.authenticated) {
      writeSessionId(null);
      setSessionId("");
      setAccounts([]);
      setActiveEmail(null);
      onAuthSessionChange?.();
      return;
    }
    setAccounts(d.accounts || []);
    setActiveEmail(d.activeEmail || null);
    if (d.activeEmail) onLinkedEmail(d.activeEmail);
  }, [onAuthSessionChange, onLinkedEmail]);

  useEffect(() => {
    void (async () => {
      const res = await stitchFetch("/api/health");
      const { data, parseError } = await readJsonFromResponse(res);
      if (!parseError && data && typeof data === "object" && "google_oauth" in data) {
        setBridgeHasGoogle(Boolean((data as { google_oauth?: boolean }).google_oauth));
      } else {
        setBridgeHasGoogle(false);
      }
    })();
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      if (ev.data?.type !== "stitch-google-oauth") return;
      setLoading(false);
      const p = ev.data.payload as { ok?: boolean; session_id?: string; email?: string; error?: string; detail?: string };
      if (!p?.ok) {
        const err = p.error === "access_denied" ? "Sign-in cancelled or permission denied." : p.error || p.detail || "Google sign-in failed.";
        setOauthMessage(err);
        return;
      }
      if (p.session_id) {
        writeSessionId(p.session_id);
        setSessionId(p.session_id);
        setOauthMessage(null);
        setLoading(false);
        void refreshStatus();
        if (p.email) onLinkedEmail(p.email);
        onAuthSessionChange?.();
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [onLinkedEmail, onAuthSessionChange, refreshStatus]);

  async function startGoogle() {
    setOauthMessage(null);
    setLoading(true);
    try {
      const origin = window.location.origin;
      const res = await stitchFetch("/api/auth/google/url", {
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
    } catch {
      setOauthMessage("Network error — is stitch_rag_bridge.py running?");
      setLoading(false);
    }
  }

  async function signOut() {
    const sid = readSessionId();
    if (sid) {
      await stitchFetch("/api/auth/logout", { method: "POST", headers: authHeaders(sid) }).catch(() => undefined);
    }
    writeDemoMagicAuth(false);
    writeSessionId(null);
    setSessionId("");
    setAccounts([]);
    setActiveEmail(null);
    void refreshStatus();
    onAuthSessionChange?.();
  }

  async function setPrimary(email: string) {
    const sid = readSessionId();
    if (!sid) return;
    const res = await stitchFetch("/api/auth/active-email", {
      method: "POST",
      headers: { ...authHeaders(sid), "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const { data, parseError } = await readJsonFromResponse(res);
    if (parseError || !res.ok) {
      setOauthMessage((data as { error?: string })?.error || "Could not set primary email.");
      return;
    }
    setActiveEmail(email);
    onLinkedEmail(email);
    void refreshStatus();
  }

  const signedIn = Boolean(sessionId && accounts.length > 0);
  const primary = useMemo(() => accounts.find((a) => a.email === activeEmail) ?? accounts[0], [accounts, activeEmail]);

  return (
    <section
      id="stitch-google-signin"
      className="noir-card p-4 md:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-sm font-bold text-stitch-heading">Google</p>
          <p className="mt-1 max-w-xl font-body text-[11px] leading-relaxed text-stitch-muted">
            Link Gmail (read-only) to discover renewals and sync subscription data with this workspace.
          </p>
        </div>
        {signedIn && primary ? (
          <div className="flex items-center gap-2">
            {primary.pictureUrl ? (
              <img src={primary.pictureUrl} alt="" className="h-9 w-9 rounded-full ring-1 ring-stitch-border/60" />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-stitch-neutral/50 font-body text-xs font-bold text-stitch-heading">
                {primary.email[0]?.toUpperCase() ?? "?"}
              </div>
            )}
            <div className="text-right">
              <p className="font-body text-xs font-semibold text-stitch-heading">{primary.email}</p>
              <button type="button" onClick={() => void signOut()} className="font-body text-[10px] text-[#baf2ff] underline">
                Sign out
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {bridgeHasGoogle === false ? (
        <div className="mt-3 rounded-lg border border-stitch-warning/40 bg-stitch-warning/10 p-3 font-body text-[11px] leading-relaxed text-stitch-warning">
          <p className="font-semibold text-stitch-heading">Setup needed — Google isn&apos;t wired yet</p>
          <p className="mt-1 text-stitch-text">
            Add OAuth keys to your bridge <code className="rounded bg-stitch-tertiary px-1 text-stitch-heading">.env</code>, restart the Python bridge,
            then paste the callback URL in Google Cloud Console. See project docs for the full checklist.
          </p>
        </div>
      ) : null}

      {!signedIn ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={loading || bridgeHasGoogle === false}
            onClick={() => void startGoogle()}
            className="inline-flex items-center gap-2 rounded-lg border border-stitch-border/60 bg-stitch-card px-3 py-2 font-body text-xs font-semibold text-stitch-heading shadow-sm disabled:opacity-50"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
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
            {loading ? "Connecting…" : "Sign in with Google"}
          </button>
        </div>
      ) : null}

      {oauthMessage ? <p className="mt-3 whitespace-pre-wrap font-body text-xs text-stitch-warning">{oauthMessage}</p> : null}

      {signedIn && accounts.length > 1 ? (
        <div className="mt-3 rounded-lg bg-stitch-neutral/25 p-2">
          <p className="font-body text-[10px] font-semibold uppercase tracking-wide text-stitch-secondary">Primary email (notifications)</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {accounts.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => void setPrimary(a.email)}
                className={
                  a.email === activeEmail
                    ? "rounded border border-black bg-stitch-primary px-2 py-0.5 font-body text-[10px] font-semibold text-black shadow-[1px_1px_0_0_#000]"
                    : "rounded border border-stitch-border bg-stitch-card px-2 py-0.5 font-body text-[10px] text-stitch-heading"
                }
              >
                {a.email}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {signedIn ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void startGoogle()}
            disabled={loading}
            className="rounded-full bg-stitch-card px-3 py-1.5 font-body text-xs font-semibold text-stitch-heading ring-1 ring-stitch-secondary/45 disabled:opacity-50"
          >
            Add another Google account
          </button>
        </div>
      ) : null}
    </section>
  );
}
