/**
 * Gamified "Upcoming" dashboard — composes WelcomeHero, stats, Gmail discovery,
 * quest timeline, subscription cards, and face MFA modal.
 *
 * API usage stays in child components / props (no route changes).
 */
import { type CSSProperties, type FormEvent, useEffect, useMemo, useState } from "react";
import type { PaymentRecord, SubscriptionCategory, SubscriptionItem } from "../fixtures/subscriptions";
import { confettiPieceClass, ensureGamifyKeyframesStyle, motion } from "./animations";
import { GamificationStats } from "./GamificationStats";
import { GmailSubscriptionDiscovery } from "./GmailSubscriptionDiscovery";
import { SubscriptionCard } from "./SubscriptionCard";
import { WelcomeHero } from "./WelcomeHero";

export type DashboardProps = {
  googleSignedIn: boolean;
  authEmailCommitted: string;
  history: PaymentRecord[];
  subscriptions: SubscriptionItem[];
  subscriptionsLoading: boolean;
  subscriptionsMutating: boolean;
  confettiTrigger: number;
  gamifyRefreshTick: number;
  onApprove: (subscription: SubscriptionItem) => void;
  onDelete: (id: string) => void;
  onAdd: (item: SubscriptionItem) => void;
  onGmailImportSuccess: (message: string) => void;
  onGmailImportError: (message: string) => void;
  onSubscriptionsRefresh: () => void;
  onRequestGoogleConnect?: () => void;
  /** Increment to trigger Gmail discovery (e.g. voice). */
  gmailDiscoverSignal?: number;
};

function newSubscriptionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `sub-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function savingsThisMonth(history: PaymentRecord[]): number {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  return history.reduce((sum, h) => {
    const d = new Date(h.approvedAtIso);
    if (d.getFullYear() === y && d.getMonth() === m) return sum + h.amountUsd;
    return sum;
  }, 0);
}

function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0]?.trim() ?? "";
  if (!local) return "";
  return local.charAt(0).toUpperCase() + local.slice(1);
}

function daysUntil(iso: string): number {
  const due = new Date(`${iso}T12:00:00`).getTime();
  return Math.ceil((due - Date.now()) / 86400000);
}

type WeekGroup = "this_week" | "next_week" | "later";

function weekBucket(iso: string): WeekGroup {
  const d = daysUntil(iso);
  if (d <= 7) return "this_week";
  if (d <= 14) return "next_week";
  return "later";
}

function DemoPayModal({ subscription, onClose }: { subscription: SubscriptionItem; onClose: () => void }) {
  const amount = subscription.amountUsd.toFixed(2);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="demo-pay-title">
      <button
        type="button"
        className="absolute inset-0 bg-stitch-surface/80 backdrop-blur-sm"
        aria-label="Close demo payment dialog"
        onClick={onClose}
      />
      <div className="noir-card relative z-10 w-full max-w-md p-6">
        <p id="demo-pay-title" className="font-display text-lg font-bold text-stitch-heading">
          Demo payment
        </p>
        <p className="mt-3 font-body text-sm text-stitch-text">
          Demo mode — no real money moves. This would charge <span className="font-mono font-bold text-stitch-success">${amount}</span>
        </p>
        <p className="mt-2 font-body text-xs text-stitch-muted">{subscription.name}</p>
        <div className="mt-6 flex justify-end">
          <button type="button" onClick={onClose} className="noir-cmd-primary rounded px-4 py-2 font-body text-xs">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfettiBurst({ tick }: { tick: number }) {
  const [pieces, setPieces] = useState<Array<{ id: number; x: number; y: number; r: number; emoji: string }>>([]);

  useEffect(() => {
    if (tick <= 0) return;
    const emojis = ["✨", "⭐", "💫", "🎉", "💰", "🏆"];
    const next = Array.from({ length: 14 }, (_, i) => ({
      id: tick * 100 + i,
      x: 20 + Math.random() * 60,
      y: 40 + Math.random() * 20,
      r: Math.random() * 360,
      emoji: emojis[i % emojis.length]!,
    }));
    setPieces(next);
    const t = window.setTimeout(() => setPieces([]), 1000);
    return () => clearTimeout(t);
  }, [tick]);

  if (pieces.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[55] overflow-hidden" aria-hidden>
      {pieces.map((p) => (
        <span
          key={p.id}
          className={confettiPieceClass}
          style={
            {
              left: `${p.x}%`,
              top: `${p.y}%`,
              ["--dx" as string]: `${(Math.random() - 0.5) * 120}px`,
              ["--dy" as string]: `${-60 - Math.random() * 100}px`,
              transform: `rotate(${p.r}deg)`,
            } as CSSProperties
          }
        >
          {p.emoji}
        </span>
      ))}
    </div>
  );
}

export function Dashboard({
  googleSignedIn,
  authEmailCommitted,
  history,
  subscriptions,
  subscriptionsLoading,
  subscriptionsMutating,
  confettiTrigger,
  gamifyRefreshTick,
  onApprove,
  onDelete,
  onAdd,
  onGmailImportSuccess,
  onGmailImportError,
  onSubscriptionsRefresh,
  onRequestGoogleConnect,
  gmailDiscoverSignal = 0,
}: DashboardProps) {
  const savedMonth = useMemo(() => savingsThisMonth(history), [history]);
  const welcomeName = displayNameFromEmail(authEmailCommitted);

  const [addName, setAddName] = useState("");
  const [addAmount, setAddAmount] = useState("");
  const [addDue, setAddDue] = useState(() => new Date().toISOString().slice(0, 10));
  const [addCategory, setAddCategory] = useState<SubscriptionCategory>("software");
  const [demoPayTarget, setDemoPayTarget] = useState<SubscriptionItem | null>(null);

  useEffect(() => {
    ensureGamifyKeyframesStyle();
  }, []);

  function submitAdd(e: FormEvent) {
    e.preventDefault();
    const name = addName.trim();
    const amount = Number.parseFloat(addAmount);
    if (!name || !Number.isFinite(amount) || amount < 0) return;
    const due = addDue.trim() || new Date().toISOString().slice(0, 10);
    onAdd({
      id: newSubscriptionId(),
      name,
      category: addCategory,
      amountUsd: Math.round(amount * 100) / 100,
      dueDateIso: due,
      status: "pending",
    });
    setAddName("");
    setAddAmount("");
    setAddDue(new Date().toISOString().slice(0, 10));
    setAddCategory("software");
  }

  const pendingSubs = useMemo(() => subscriptions.filter((s) => s.status === "pending"), [subscriptions]);
  const grouped = useMemo(() => {
    const m: Record<WeekGroup, SubscriptionItem[]> = { this_week: [], next_week: [], later: [] };
    for (const s of pendingSubs) {
      m[weekBucket(s.dueDateIso)].push(s);
    }
    return m;
  }, [pendingSubs]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-transparent">
      <ConfettiBurst tick={confettiTrigger} />
      {demoPayTarget ? <DemoPayModal subscription={demoPayTarget} onClose={() => setDemoPayTarget(null)} /> : null}

      <div className="relative z-[1] min-h-0 flex-1 space-y-5 overflow-y-auto bg-transparent px-4 py-5 lg:px-6">
        <WelcomeHero
          googleSignedIn={googleSignedIn}
          displayName={welcomeName}
          savedThisMonthUsd={savedMonth}
          onRequestGoogleConnect={onRequestGoogleConnect}
        />

        <div
          className="flex items-center justify-center rounded-sm border-2 border-black bg-amber-500/10 px-3 py-2 font-body text-[10px] font-bold uppercase tracking-[0.15em] text-amber-200 shadow-[4px_4px_0_0_#000]"
          role="status"
        >
          Demo — no real money moves
        </div>

        <GamificationStats refreshTick={gamifyRefreshTick} savedThisMonthUsd={savedMonth} />

        {googleSignedIn ? (
          <GmailSubscriptionDiscovery
            googleSignedIn={googleSignedIn}
            onImported={onSubscriptionsRefresh}
            onSuccess={onGmailImportSuccess}
            onError={onGmailImportError}
            autoDiscoverSignal={gmailDiscoverSignal}
          />
        ) : null}

        <section className="noir-card p-4 md:p-5" aria-labelledby="upcoming-board-title">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="upcoming-board-title" className="font-display text-lg font-bold text-stitch-heading md:text-xl">
              Upcoming renewals
            </h2>
          </div>
          {!googleSignedIn ? (
            <p className="mt-3 font-body text-sm text-stitch-muted">
              Link Google from <strong className="text-stitch-heading">Settings → Account</strong> to sync subscriptions from Gmail.
            </p>
          ) : null}

          {googleSignedIn && subscriptionsLoading ? (
            <div className="mt-4 space-y-3" aria-busy="true" aria-label="Loading subscriptions">
              <div className={`h-24 ${motion.skeleton}`} />
              <div className={`h-24 ${motion.skeleton}`} />
            </div>
          ) : null}

          {googleSignedIn && !subscriptionsLoading && subscriptions.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-stitch-border bg-stitch-surface/80 p-6 text-center font-body text-sm text-stitch-text">
              No subscriptions yet — add one below or import from Gmail.
            </p>
          ) : null}

          {googleSignedIn && !subscriptionsLoading && pendingSubs.length > 0 ? (
            <div className="mt-5 space-y-8">
              <TimelineGroup title="This week" subtitle="Due within 7 days" items={grouped.this_week} mutating={subscriptionsMutating} onApprove={onApprove} onDelete={onDelete} onDemoPay={setDemoPayTarget} urgent />
              <TimelineGroup title="Next week" subtitle="8–14 days" items={grouped.next_week} mutating={subscriptionsMutating} onApprove={onApprove} onDelete={onDelete} onDemoPay={setDemoPayTarget} />
              <TimelineGroup title="Later" subtitle="Beyond 14 days" items={grouped.later} mutating={subscriptionsMutating} onApprove={onApprove} onDelete={onDelete} onDemoPay={setDemoPayTarget} />
            </div>
          ) : null}

          {googleSignedIn && !subscriptionsLoading && subscriptions.some((s) => s.status === "paid") ? (
            <div className="mt-6 border-t border-stitch-border pt-4">
              <p className="font-body text-xs font-semibold uppercase tracking-wide text-stitch-muted">Paid / cleared</p>
              <ul className="mt-2 space-y-2">
                {subscriptions
                  .filter((s) => s.status === "paid")
                  .map((sub) => (
                    <li key={sub.id}>
                      <SubscriptionCard subscription={sub} mutating={subscriptionsMutating} onApprove={onApprove} onDelete={onDelete} onDemoPay={setDemoPayTarget} />
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}

          {googleSignedIn ? (
            <form
              onSubmit={submitAdd}
              className="noir-card-sm mt-6 space-y-3 p-4"
              aria-label="Add subscription"
            >
              <p className="font-display text-sm font-bold text-stitch-heading">Add subscription</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="font-body text-[10px] font-semibold text-stitch-muted">
                  Name
                  <input
                    value={addName}
                    onChange={(ev) => setAddName(ev.target.value)}
                    required
                    placeholder="Netflix"
                    className="mt-1 w-full rounded border border-stitch-border bg-stitch-card px-2 py-2 font-body text-sm text-stitch-heading placeholder:text-stitch-placeholder"
                  />
                </label>
                <label className="font-body text-[10px] font-semibold text-stitch-muted">
                  Amount (USD)
                  <input
                    value={addAmount}
                    onChange={(ev) => setAddAmount(ev.target.value)}
                    required
                    inputMode="decimal"
                    placeholder="15.99"
                    className="mt-1 w-full rounded border border-stitch-border bg-stitch-card px-2 py-2 font-body text-sm text-stitch-heading placeholder:text-stitch-placeholder"
                  />
                </label>
                <label className="font-body text-[10px] font-semibold text-stitch-muted">
                  Due date
                  <input
                    type="date"
                    value={addDue}
                    onChange={(ev) => setAddDue(ev.target.value)}
                    required
                    className="mt-1 w-full rounded border border-stitch-border bg-stitch-card px-2 py-2 font-body text-sm text-stitch-heading"
                  />
                </label>
                <label className="font-body text-[10px] font-semibold text-stitch-muted">
                  Category
                  <select
                    value={addCategory}
                    onChange={(ev) => setAddCategory(ev.target.value as SubscriptionCategory)}
                    className="mt-1 w-full rounded border border-stitch-border bg-stitch-card px-2 py-2 font-body text-sm text-stitch-heading"
                  >
                    <option value="software">Software</option>
                    <option value="streaming">Streaming</option>
                    <option value="music">Music</option>
                    <option value="fitness">Fitness</option>
                    <option value="shopping">Shopping</option>
                  </select>
                </label>
              </div>
              <button
                type="submit"
                disabled={subscriptionsMutating}
                className="rounded border border-black bg-stitch-success px-4 py-2 font-body text-xs font-bold text-black shadow-[2px_2px_0_0_#000] hover:brightness-110 disabled:opacity-50"
              >
                {subscriptionsMutating ? "Saving…" : "Add subscription"}
              </button>
            </form>
          ) : null}
        </section>

        <div className="h-20 shrink-0" aria-hidden />
      </div>

    </div>
  );
}

function TimelineGroup({
  title,
  subtitle,
  items,
  mutating,
  onApprove,
  onDelete,
  onDemoPay,
  urgent,
}: {
  title: string;
  subtitle: string;
  items: SubscriptionItem[];
  mutating: boolean;
  onApprove: (s: SubscriptionItem) => void;
  onDelete: (id: string) => void;
  onDemoPay: (s: SubscriptionItem) => void;
  urgent?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <header className="mb-3 flex items-baseline gap-2">
        <h3 className="font-display text-sm font-bold text-[#baf2ff]">{title}</h3>
        <span className="font-body text-[11px] text-stitch-muted">{subtitle}</span>
        {urgent ? <span className="ml-auto font-body text-[10px] font-bold uppercase text-stitch-error">Due soon</span> : null}
      </header>
      <ul className="space-y-3">
        {items.map((sub) => (
          <li key={sub.id} className={urgent && daysUntil(sub.dueDateIso) <= 2 ? motion.pulseUrgent : ""}>
            <SubscriptionCard subscription={sub} mutating={mutating} onApprove={onApprove} onDelete={onDelete} onDemoPay={onDemoPay} />
          </li>
        ))}
      </ul>
    </div>
  );
}
