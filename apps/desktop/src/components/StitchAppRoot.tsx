import { useCallback, useEffect, useState } from "react";
import {
  authHeaders,
  consumeStitchGoogleOAuthUrlFragment,
  readJsonFromResponse,
  readSessionId,
  stitchRagApiUrl,
  writeDemoMagicAuth,
  writeSessionId,
  writeUserEmail,
} from "../lib/stitchBridge";
import { ThemeProvider } from "../context/ThemeContext";
import { AppShell } from "./AppShell";
import { SignInPage } from "./SignInPage";

function useHistoryPath() {
  const [path, setPath] = useState(() => window.location.pathname || "/");
  const navigate = useCallback((next: string, replace = false) => {
    if (next === window.location.pathname) {
      setPath(next);
      return;
    }
    if (replace) window.history.replaceState({}, "", next);
    else window.history.pushState({}, "", next);
    setPath(next);
  }, []);
  useEffect(() => {
    const pop = () => setPath(window.location.pathname || "/");
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  return { path, navigate };
}

async function checkServerSession(): Promise<{ ok: boolean; invalidSession: boolean }> {
  const sid = readSessionId();
  if (!sid) return { ok: false, invalidSession: false };
  try {
    const res = await fetch(stitchRagApiUrl("/api/auth/status"), { headers: authHeaders(sid), method: "GET" });
    const { data, parseError } = await readJsonFromResponse(res);
    if (parseError || !data || typeof data !== "object") return { ok: false, invalidSession: false };
    const d = data as {
      authenticated?: boolean;
      accounts?: unknown[];
      invalidSession?: boolean;
    };
    if (d.invalidSession) {
      writeSessionId(null);
      return { ok: false, invalidSession: true };
    }
    const accounts = Array.isArray(d.accounts) ? d.accounts : [];
    if (d.authenticated && accounts.length > 0) {
      writeDemoMagicAuth(false);
      return { ok: true, invalidSession: false };
    }
    return { ok: false, invalidSession: false };
  } catch {
    return { ok: false, invalidSession: false };
  }
}

export default function StitchAppRoot() {
  const { path, navigate } = useHistoryPath();
  const [authReady, setAuthReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const refreshAuth = useCallback(async (): Promise<boolean> => {
    const frag = consumeStitchGoogleOAuthUrlFragment();
    if (frag.kind === "error") {
      setToast(frag.message);
      window.setTimeout(() => setToast((t) => (t === frag.message ? null : t)), 5000);
    }
    const server = await checkServerSession();
    if (server.ok) {
      setAuthenticated(true);
      setAuthReady(true);
      return true;
    }
    /** Demo magic link is not auto-resumed on load â€” user always sees Sign-in first; magic completes via `handleSignedIn('demo')`. */
    setAuthenticated(false);
    setAuthReady(true);
    return false;
  }, []);

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  useEffect(() => {
    if (!authReady) return;
    if (authenticated) {
      if (path === "/signin" || path === "/") navigate("/app", false);
      return;
    }
    if (path === "/app" || path.startsWith("/app/")) {
      navigate("/signin", true);
      return;
    }
    if (path !== "/signin") navigate("/signin", true);
  }, [authReady, authenticated, path, navigate]);

  const handleSignedIn = useCallback(
    async (mode?: "google" | "demo") => {
      if (mode === "demo") {
        setAuthenticated(true);
        navigate("/app", false);
        return;
      }
      // Google: callback already created the session; avoid awaiting a second /api/auth/status round-trip.
      if (readSessionId()) {
        void (async () => {
          try {
            const sid = readSessionId();
            const res = await fetch(stitchRagApiUrl("/api/auth/status"), { headers: authHeaders(sid), method: "GET" });
            const { data, parseError } = await readJsonFromResponse(res);
            if (parseError || !data || typeof data !== "object") return;
            const d = data as {
              accounts?: Array<{ email: string }>;
              activeEmail?: string | null;
            };
            const first = d.accounts?.[0]?.email;
            const active = ((d.activeEmail || "").trim() || first || "").trim();
            if (active) writeUserEmail(active);
          } catch {
            /* ignore */
          }
        })();
        setAuthenticated(true);
        navigate("/app", false);
        return;
      }
      const ok = await refreshAuth();
      if (ok) navigate("/app", false);
    },
    [refreshAuth, navigate],
  );

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 4000);
  }, []);

  if (!authReady) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-transparent font-body text-sm text-stitch-muted">
        Checking secure sessionâ€¦
      </div>
    );
  }

  return (
    <>
      {!authenticated ? <SignInPage onSignedIn={(m) => void handleSignedIn(m)} onToast={showToast} /> : null}
      {authenticated ? (
        <ThemeProvider>
          <AppShell
            onAuthGateRefresh={async () => {
              await refreshAuth();
            }}
            onLogoutSuccess={showToast}
          />
        </ThemeProvider>
      ) : null}
      {toast ? (
        <div className="fixed right-4 top-4 z-[100] max-w-sm rounded-sm border-2 border-black bg-stitch-card px-3 py-2 font-body text-xs font-semibold text-stitch-success shadow-[4px_4px_0_0_#000]">
          {toast}
        </div>
      ) : null}
    </>
  );
}
