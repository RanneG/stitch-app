import { useEffect, useState } from "react";
import { readJsonFromResponse, stitchRagApiUrl } from "../lib/stitchBridge";
import { motion } from "./animations";

export type WelcomeHeroProps = {
  googleSignedIn: boolean;
  /** First name or short handle (e.g. from email local-part). */
  displayName: string;
  /** Sum of approved amounts this calendar month (USD). */
  savedThisMonthUsd: number;
  /** Opens Settings and scrolls to Google linking (replaces in-page anchor). */
  onRequestGoogleConnect?: () => void;
};

export function WelcomeHero({ googleSignedIn, displayName, savedThisMonthUsd, onRequestGoogleConnect }: WelcomeHeroProps) {
  const [bridgeHasGoogle, setBridgeHasGoogle] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(stitchRagApiUrl("/api/health"));
        const { data, parseError } = await readJsonFromResponse(res);
        if (cancelled) return;
        if (!parseError && data && typeof data === "object" && "google_oauth" in data) {
          setBridgeHasGoogle(Boolean((data as { google_oauth?: boolean }).google_oauth));
        } else {
          setBridgeHasGoogle(false);
        }
      } catch {
        if (!cancelled) setBridgeHasGoogle(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const friendlyName = displayName.trim() || "friend";

  return (
    <section className="noir-card relative overflow-hidden p-5 md:p-6" aria-labelledby="welcome-hero-title">
      {bridgeHasGoogle === false ? (
        <div className="relative z-[1] max-w-2xl">
          <p id="welcome-hero-title" className="font-display text-xl font-bold tracking-tight text-stitch-heading md:text-2xl">
            Connect Google to sync subscriptions
          </p>
          <p className="mt-2 font-body text-sm leading-relaxed text-stitch-text">
            The bridge needs OAuth keys before you can sign in. Follow the steps below (about two minutes).
          </p>
          <ol className="mt-4 space-y-2 font-body text-sm text-stitch-heading">
            <li className="flex gap-2">
              <span className="font-semibold text-stitch-primary" aria-hidden>
                ①
              </span>
              <span>Add OAuth keys to your bridge `.env` (one-time).</span>
            </li>
            <li className="flex gap-2">
              <span className="font-semibold text-stitch-primary" aria-hidden>
                ②
              </span>
              <span>Restart `stitch_rag_bridge.py` so the server picks them up.</span>
            </li>
            <li className="flex gap-2">
              <span className="font-semibold text-stitch-primary" aria-hidden>
                ③
              </span>
              <span>
                Open <strong className="text-stitch-heading">Settings</strong> → <strong className="text-stitch-heading">Account</strong> and
                use <strong className="text-stitch-heading">Connect Google</strong> — you&apos;re done.
              </span>
            </li>
          </ol>
        </div>
      ) : !googleSignedIn ? (
        <div className="relative z-[1] flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p id="welcome-hero-title" className="font-display text-xl font-bold text-stitch-heading md:text-2xl">
              Connect Gmail
            </p>
            <p className="mt-2 max-w-xl font-body text-sm leading-relaxed text-stitch-text">
              Link Google to sync renewals, scan Gmail for subscriptions, and keep this dashboard current.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onRequestGoogleConnect?.()}
            className={`noir-cmd-primary inline-flex shrink-0 items-center justify-center rounded px-5 py-3 font-display text-sm ${motion.pressable}`}
          >
            Connect Google
          </button>
        </div>
      ) : (
        <div className="relative z-[1] flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p id="welcome-hero-title" className="font-display text-xl font-bold text-stitch-heading md:text-2xl">
              Welcome back, {friendlyName}! <span aria-hidden>👋</span>
            </p>
            <p className="mt-2 font-body text-sm text-stitch-text">
              You&apos;ve routed{" "}
              <span className="font-mono text-lg font-bold text-stitch-success">${savedThisMonthUsd.toFixed(2)}</span> through
              approvals this month.
            </p>
          </div>
          <div
            className="noir-card-sm rounded-lg px-4 py-3 text-right"
            role="status"
            aria-label="Monthly savings counter"
          >
            <p className="font-body text-[10px] font-semibold uppercase tracking-widest text-stitch-muted">This month</p>
            <p className="font-mono text-2xl font-bold tabular-nums text-stitch-success">${savedThisMonthUsd.toFixed(0)}</p>
            <p className="font-body text-[11px] text-stitch-muted">approved payments</p>
          </div>
        </div>
      )}
    </section>
  );
}
