import { useEffect, useState } from "react";
import { levelFromPoints, readGamify, type GamifyPersisted } from "./gamifyStorage";
import { motion } from "./animations";

const BADGE_META: Record<string, { label: string; emoji: string }> = {
  first_quest: { label: "First Subscription", emoji: "🎯" },
  week_warrior: { label: "Week Warrior", emoji: "⚔️" },
  streak_flame: { label: "Streak Legend", emoji: "🔥" },
};

export type GamificationStatsProps = {
  /** When this increments (e.g. after approval), re-read local stats. */
  refreshTick: number;
  savedThisMonthUsd: number;
};

export function GamificationStats({ refreshTick, savedThisMonthUsd }: GamificationStatsProps) {
  const [g, setG] = useState<GamifyPersisted>(() => readGamify());

  useEffect(() => {
    setG(readGamify());
  }, [refreshTick]);

  const { level, title } = levelFromPoints(g.points);
  const badges = (g.achievements || []).slice(0, 3).map((id) => BADGE_META[id] ?? { label: id, emoji: "🏅" });

  return (
    <section className="noir-card p-4 md:p-5" aria-label="Progress and streaks">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stitch-border pb-3">
        <div>
          <p className="font-body text-[10px] font-semibold uppercase tracking-widest text-stitch-muted">Your level</p>
          <p className="font-display text-lg font-bold text-stitch-heading">
            Lv {level} <span className="text-[#00daf8]">·</span>{" "}
            <span className="text-sm font-semibold text-[#baf2ff]">{title}</span>
          </p>
        </div>
        <p className="rounded border border-stitch-warning/40 bg-stitch-warning/10 px-3 py-1 font-body text-xs font-semibold text-stitch-warning shadow-[2px_2px_0_0_#000]">
          Check in tomorrow for 50 bonus points
        </p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Approval streak"
          value={`${Math.max(1, g.streakDays)} day${g.streakDays === 1 ? "" : "s"}`}
          emoji="🔥"
          sub="Keep approving on time"
        />
        <StatTile label="Score" value={String(g.points)} emoji="🏆" sub="From approvals" mono />
        <div className={`noir-card-sm p-3 ${motion.cardHover}`}>
          <p className="font-body text-[10px] font-semibold uppercase tracking-wide text-stitch-muted">Achievements</p>
          <ul className="mt-2 flex flex-wrap gap-2" aria-label="Achievement badges">
            {badges.length === 0 ? (
              <li className="font-body text-xs text-stitch-muted">Approve a renewal to unlock badges</li>
            ) : (
              badges.map((b) => (
                <li
                  key={b.label}
                  className="flex items-center gap-1 rounded border border-stitch-border bg-stitch-surface/80 px-2 py-1 font-body text-[11px] font-medium text-[#baf2ff] shadow-[1px_1px_0_0_#000]"
                  title={b.label}
                >
                  <span aria-hidden>{b.emoji}</span>
                  <span>{b.label}</span>
                </li>
              ))
            )}
          </ul>
        </div>
        <StatTile
          label="Savings spotlight"
          value={`$${savedThisMonthUsd.toFixed(0)}`}
          emoji="💰"
          sub="This month"
          mono
        />
      </div>
    </section>
  );
}

function StatTile({
  label,
  value,
  emoji,
  sub,
  mono,
}: {
  label: string;
  value: string;
  emoji: string;
  sub: string;
  mono?: boolean;
}) {
  return (
    <div className={`noir-card-sm p-3 ${motion.cardHover}`}>
      <p className="font-body text-[10px] font-semibold uppercase tracking-wide text-stitch-muted">
        <span aria-hidden>{emoji}</span> {label}
      </p>
      <p className={`mt-1 text-xl font-bold text-stitch-heading ${mono ? "font-mono tabular-nums" : "font-display"}`}>{value}</p>
      <p className="font-body text-[11px] text-stitch-muted">{sub}</p>
    </div>
  );
}
