import { useCallback, useEffect, useRef, useState } from "react";
import { authHeaders, readJsonFromResponse, readSessionId, stitchFetch } from "../lib/stitchBridge";

/** Set to `true` to always use mock candidates (ignores live Gmail even when connected). */
const USE_MOCK_DISCOVERY = false;

const MOCK_DELAY_MS = 450;

export type GmailDiscoveryCandidate = {
  serviceName: string;
  amountUsd: number;
  renewalDateIso: string;
  category: string;
  sourceEmail?: string;
};

const MOCK_CANDIDATES: GmailDiscoveryCandidate[] = [
  {
    serviceName: "Netflix",
    amountUsd: 15.99,
    renewalDateIso: "2026-05-15",
    category: "streaming",
    sourceEmail: "billing@netflix.com",
  },
  {
    serviceName: "Spotify",
    amountUsd: 9.99,
    renewalDateIso: "2026-06-03",
    category: "music",
    sourceEmail: "no-reply@spotify.com",
  },
  {
    serviceName: "Adobe Creative Cloud",
    amountUsd: 54.99,
    renewalDateIso: "2026-05-28",
    category: "software",
    sourceEmail: "mail@adobe.com",
  },
];

function monthDayLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

type Props = {
  googleSignedIn: boolean;
  onImported: () => void | Promise<void>;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  /** Increment (e.g. from voice) to run the same path as “Run discovery”. */
  autoDiscoverSignal?: number;
};

export function GmailSubscriptionDiscovery({
  googleSignedIn,
  onImported,
  onSuccess,
  onError,
  autoDiscoverSignal = 0,
}: Props) {
  const [discoverBusy, setDiscoverBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [candidates, setCandidates] = useState<GmailDiscoveryCandidate[]>([]);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  /** Linked Google account(s) with refresh token — required for live Gmail discovery. */
  const [gmailLinkStatus, setGmailLinkStatus] = useState<"loading" | "linked" | "none">("loading");

  const hasValidGmailToken = gmailLinkStatus === "linked";
  const prevAutoDiscover = useRef(0);

  useEffect(() => {
    if (!googleSignedIn) {
      setGmailLinkStatus("none");
      return;
    }
    let cancelled = false;
    void (async () => {
      setGmailLinkStatus("loading");
      const sid = readSessionId();
      if (!sid) {
        if (!cancelled) setGmailLinkStatus("none");
        return;
      }
      try {
        const res = await stitchFetch("/api/auth/status", { headers: authHeaders(sid) });
        const { data, parseError } = await readJsonFromResponse(res);
        if (cancelled) return;
        if (parseError || !res.ok) {
          setGmailLinkStatus("none");
          return;
        }
        const d = data as {
          authenticated?: boolean;
          accounts?: unknown[];
          invalidSession?: boolean;
        };
        if (d.invalidSession || !d.authenticated) {
          setGmailLinkStatus("none");
          return;
        }
        const hasAccounts = Array.isArray(d.accounts) && d.accounts.length > 0;
        setGmailLinkStatus(hasAccounts ? "linked" : "none");
      } catch {
        if (!cancelled) setGmailLinkStatus("none");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [googleSignedIn]);

  const runDiscovery = useCallback(async () => {
    const sid = readSessionId();
    if (!sid) {
      onError("Sign in with Google first.");
      return;
    }
    setDiscoverBusy(true);
    try {
      const useLiveGmail = !USE_MOCK_DISCOVERY && hasValidGmailToken;
      if (!useLiveGmail) {
        await new Promise((r) => setTimeout(r, MOCK_DELAY_MS));
        setCandidates(MOCK_CANDIDATES);
        const sel: Record<number, boolean> = {};
        MOCK_CANDIDATES.forEach((_, i) => {
          sel[i] = true;
        });
        setSelected(sel);
        return;
      }

      const res = await stitchFetch("/api/subscriptions/from-gmail", { headers: authHeaders(sid) });
      const { data, parseError } = await readJsonFromResponse(res);
      if (parseError) {
        onError(parseError);
        return;
      }
      const d = data as {
        ok?: boolean;
        candidates?: Array<Record<string, unknown>>;
        error?: string;
        detail?: string;
      };
      if (!res.ok || !d.ok) {
        onError(String(d.detail || d.error || "Could not scan Gmail."));
        return;
      }
      const raw = d.candidates || [];
      const mapped: GmailDiscoveryCandidate[] = [];
      for (const c of raw) {
        if (!c || typeof c !== "object") continue;
        const serviceName = String((c as { serviceName?: unknown }).serviceName || "").trim();
        if (!serviceName) continue;
        const amountRaw = (c as { amountUsd?: unknown }).amountUsd;
        const amountUsd = typeof amountRaw === "number" && Number.isFinite(amountRaw) ? amountRaw : Number(amountRaw) || 0;
        const renewalDateIso = String((c as { renewalDateIso?: unknown }).renewalDateIso || "").trim() || new Date().toISOString().slice(0, 10);
        const category = String((c as { category?: unknown }).category || "software");
        const sourceEmail =
          typeof (c as { sourceEmail?: unknown }).sourceEmail === "string"
            ? ((c as { sourceEmail?: string }).sourceEmail as string)
            : undefined;
        mapped.push({ serviceName, amountUsd, renewalDateIso, category, sourceEmail });
      }
      setCandidates(mapped);
      const sel: Record<number, boolean> = {};
      mapped.forEach((_, i) => {
        sel[i] = true;
      });
      setSelected(sel);
      if (mapped.length === 0) {
        onSuccess("No forgotten quests in this sweep — inbox looks clean. Try again after more mail arrives.");
      }
    } catch {
      onError("Network hiccup while scanning your inbox — try again in a moment.");
    } finally {
      setDiscoverBusy(false);
    }
  }, [hasValidGmailToken, onError, onSuccess]);

  useEffect(() => {
    if (!autoDiscoverSignal || autoDiscoverSignal <= prevAutoDiscover.current) return;
    prevAutoDiscover.current = autoDiscoverSignal;
    if (googleSignedIn) void runDiscovery();
  }, [autoDiscoverSignal, googleSignedIn, runDiscovery]);

  const importSelected = useCallback(async () => {
    const sid = readSessionId();
    if (!sid) {
      onError("Sign in with Google first.");
      return;
    }
    const selections = candidates
      .map((c, i) => ({ c, i }))
      .filter(({ i }) => selected[i])
      .map(({ c }) => ({
        serviceName: c.serviceName,
        amountUsd: c.amountUsd,
        renewalDateIso: c.renewalDateIso,
        category: c.category,
        sourceEmail: c.sourceEmail,
      }));
    if (selections.length === 0) {
      onError("Select at least one subscription to import.");
      return;
    }
    setImportBusy(true);
    try {
      const res = await stitchFetch("/api/subscriptions/import", {
        method: "POST",
        headers: authHeaders(sid),
        body: JSON.stringify({ selections }),
      });
      const { data, parseError } = await readJsonFromResponse(res);
      if (parseError || !res.ok) {
        onError(parseError || (data as { error?: string })?.error || "Import failed.");
        return;
      }
      const count = (data as { count?: number })?.count ?? selections.length;
      setCandidates([]);
      setSelected({});
      onSuccess(`Imported ${count} subscription${count === 1 ? "" : "s"}.`);
      await onImported();
    } catch {
      onError("Import request failed.");
    } finally {
      setImportBusy(false);
    }
  }, [candidates, onError, onImported, onSuccess, selected]);

  if (!googleSignedIn) {
    return null;
  }

  return (
    <section id="stitch-gmail-discovery" className="noir-card p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-display text-sm font-bold text-stitch-heading">Gmail — discover subscriptions</p>
          <p className="mt-1 max-w-xl font-body text-[11px] leading-relaxed text-stitch-muted">
            {USE_MOCK_DISCOVERY
              ? "Demo mode: sample subscriptions only. Set USE_MOCK_DISCOVERY to false to use real Gmail when connected."
              : hasValidGmailToken
                ? "Scans your linked Google account for subscription receipts (read-only Gmail)."
                : gmailLinkStatus === "loading"
                  ? "Checking whether Gmail is connected…"
                  : "Sign in with Google above (Gmail) to load real receipts. Until then, discovery uses safe demo data."}
          </p>
        </div>
      </div>
      {!USE_MOCK_DISCOVERY && !hasValidGmailToken && gmailLinkStatus !== "loading" ? (
        <div className="mt-3 rounded-lg border border-stitch-warning/40 bg-stitch-warning/10 px-3 py-2 font-body text-[11px] leading-relaxed text-stitch-text">
          <strong className="font-semibold text-stitch-heading">Connect Gmail first to discover real subscriptions.</strong> You can still
          preview candidates using demo rows below.
        </div>
      ) : null}
      <div className="mt-3">
        <button
          type="button"
          disabled={discoverBusy || importBusy}
          onClick={() => void runDiscovery()}
          className="noir-cmd-primary rounded px-4 py-2 font-body text-xs disabled:opacity-50"
        >
          {discoverBusy ? "Scanning inbox…" : "Run discovery"}
        </button>
      </div>

      {candidates.length > 0 ? (
        <div className="mt-4 border-t border-stitch-border pt-3">
          {USE_MOCK_DISCOVERY ? (
            <p className="rounded border border-stitch-border bg-stitch-surface/80 px-2 py-1.5 font-body text-[10px] font-semibold uppercase tracking-wide text-stitch-muted">
              Demo mode — mock data only
            </p>
          ) : !hasValidGmailToken ? (
            <p className="rounded border border-stitch-warning/40 bg-stitch-warning/10 px-2 py-1.5 font-body text-[10px] font-semibold uppercase tracking-wide text-stitch-warning">
              Demo data shown until Gmail connected
            </p>
          ) : (
            <p className="rounded border border-stitch-success/40 bg-stitch-success/10 px-2 py-1.5 font-body text-[11px] font-bold text-stitch-success">
              Found {candidates.length} subscription{candidates.length === 1 ? "" : "s"}
            </p>
          )}
          <p className="mt-2 font-body text-xs font-semibold text-stitch-heading">Select rows to import</p>
          <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto">
            {candidates.map((c, i) => (
              <li
                key={`${c.serviceName}-${c.renewalDateIso}-${i}`}
                className="noir-card-sm flex items-center gap-3 px-3 py-2"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 rounded border-stitch-border bg-stitch-card accent-[#00daf8]"
                  checked={Boolean(selected[i])}
                  onChange={(e) => setSelected((s) => ({ ...s, [i]: e.target.checked }))}
                  aria-label={`Add ${c.serviceName}`}
                />
                <div className="min-w-0 flex-1 font-body text-xs">
                  <span className="font-semibold text-stitch-heading">{c.serviceName}</span>
                  <span className="text-stitch-muted"> — ${c.amountUsd.toFixed(2)}</span>
                  <span className="text-stitch-muted"> — renews {monthDayLabel(c.renewalDateIso)}</span>
                </div>
                <span className="shrink-0 font-body text-[10px] font-semibold uppercase tracking-wide text-stitch-success">New</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={importBusy || discoverBusy}
              onClick={() => void importSelected()}
              className="rounded border border-black bg-stitch-success px-4 py-2 font-body text-xs font-bold text-black shadow-[2px_2px_0_0_#000] hover:brightness-110 disabled:opacity-50"
            >
              {importBusy ? "Adding…" : "Import selected"}
            </button>
            <button
              type="button"
              disabled={importBusy}
              onClick={() => {
                setCandidates([]);
                setSelected({});
              }}
              className="rounded border border-stitch-border bg-stitch-tertiary px-3 py-2 font-body text-xs font-semibold text-stitch-heading hover:bg-[#2a2c32] disabled:opacity-50"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
