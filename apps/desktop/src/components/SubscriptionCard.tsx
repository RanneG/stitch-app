import type { SubscriptionItem } from "../fixtures/subscriptions";
import { motion } from "./animations";

function categoryEmoji(category: SubscriptionItem["category"]) {
  switch (category) {
    case "streaming":
      return "📺";
    case "music":
      return "🎵";
    case "fitness":
      return "🏋️";
    case "shopping":
      return "📦";
    default:
      return "💳";
  }
}

function daysUntil(iso: string): number {
  const due = new Date(`${iso}T12:00:00`).getTime();
  return Math.ceil((due - Date.now()) / 86400000);
}

function renewalBarClass(days: number): string {
  if (days <= 2) return "from-rose-500 to-rose-400";
  if (days <= 7) return "from-amber-400 to-amber-300";
  return "from-emerald-500 to-emerald-400";
}

export type SubscriptionCardProps = {
  subscription: SubscriptionItem;
  mutating: boolean;
  onApprove: (s: SubscriptionItem) => void;
  onDelete: (id: string) => void;
  onDemoPay: (s: SubscriptionItem) => void;
};

export function SubscriptionCard({ subscription: sub, mutating, onApprove, onDelete, onDemoPay }: SubscriptionCardProps) {
  const days = daysUntil(sub.dueDateIso);
  const pct = Math.max(5, Math.min(100, 100 - Math.min(30, Math.max(0, days)) * (100 / 30)));

  return (
    <article
      className={`noir-card group relative overflow-hidden p-4 ${motion.cardHover}`}
      aria-label={`Subscription: ${sub.name}`}
    >
      {days <= 2 && sub.status === "pending" ? (
        <span
          className={`absolute right-3 top-3 rounded-full bg-rose-500/20 px-2 py-0.5 font-body text-[10px] font-bold uppercase tracking-wide text-rose-200 ring-1 ring-rose-400/40 ${motion.pulseUrgent}`}
        >
          Urgent
        </span>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="text-2xl" aria-hidden>
            {categoryEmoji(sub.category)}
          </span>
          <div className="min-w-0">
            <h3 className="font-display text-base font-bold text-stitch-heading">{sub.name}</h3>
            <p className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-stitch-success">${sub.amountUsd.toFixed(2)}</p>
            <p className="font-body text-xs text-stitch-muted">
              Next billing · <time dateTime={sub.dueDateIso}>{sub.dueDateIso}</time>
              {sub.sourceEmail ? (
                <span className="mt-0.5 block text-[10px] text-stitch-placeholder">via {sub.sourceEmail}</span>
              ) : null}
            </p>
          </div>
        </div>
        <span className="shrink-0 rounded border border-stitch-warning/40 bg-stitch-warning/10 px-2.5 py-1 font-mono text-xs font-bold text-stitch-warning shadow-[1px_1px_0_0_#000]">
          {days < 0 ? "Due" : `${days}d`}
        </span>
      </div>

      <div className="mt-3" role="progressbar" aria-valuenow={days} aria-valuemin={0} aria-valuemax={30} aria-label="Days until renewal">
        <div className="h-2 overflow-hidden rounded-full bg-stitch-tertiary">
          <div
            className={`h-full rounded-full bg-gradient-to-r ${renewalBarClass(days)} ${motion.barFill}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-1 font-body text-[10px] text-stitch-muted">Renewal runway (demo)</p>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2 opacity-100 transition-opacity lg:opacity-90 lg:group-hover:opacity-100">
        <button
          type="button"
          disabled={mutating}
          onClick={() => onDemoPay(sub)}
          className="rounded border border-stitch-border bg-stitch-tertiary px-3 py-1.5 font-body text-xs font-semibold text-stitch-heading hover:bg-[#2a2c32] disabled:opacity-50"
        >
          Pay now <span className="text-stitch-muted">(demo)</span>
        </button>
        {sub.status === "paid" ? (
          <span className="rounded border border-stitch-success/50 bg-stitch-success/15 px-3 py-1.5 font-body text-xs font-bold text-stitch-success shadow-[1px_1px_0_0_#000]">
            Paid
          </span>
        ) : (
          <button
            type="button"
            disabled={mutating}
            onClick={() => onApprove(sub)}
            className={`noir-cmd-primary rounded px-4 py-2 font-body text-xs disabled:opacity-50 ${motion.pressable}`}
          >
            Approve
          </button>
        )}
        <button
          type="button"
          disabled={mutating}
          onClick={() => onDelete(sub.id)}
          className="rounded border border-stitch-border bg-transparent px-3 py-1.5 font-body text-xs font-semibold text-stitch-muted hover:bg-stitch-error/10 hover:text-stitch-error disabled:opacity-50"
          aria-label={`Remove ${sub.name}`}
        >
          Remove
        </button>
      </div>
    </article>
  );
}
