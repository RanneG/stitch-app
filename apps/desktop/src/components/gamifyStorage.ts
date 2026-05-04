/**
 * Demo-only gamification persisted in localStorage (no backend).
 */

const KEY = "stitch.gamify.v1";

export type GamifyPersisted = {
  points: number;
  streakDays: number;
  lastApprovalDate: string | null;
  /** YYYY-MM-DD of last daily check-in for bonus copy */
  lastCheckInDate: string | null;
  achievements: string[];
};

const defaultState = (): GamifyPersisted => ({
  points: 0,
  streakDays: 0,
  lastApprovalDate: null,
  lastCheckInDate: null,
  achievements: [],
});

export function readGamify(): GamifyPersisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const p = JSON.parse(raw) as Partial<GamifyPersisted>;
    return {
      ...defaultState(),
      ...p,
      achievements: Array.isArray(p.achievements) ? p.achievements : [],
    };
  } catch {
    return defaultState();
  }
}

function writeGamify(next: GamifyPersisted) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  const A = new Date(`${a}T12:00:00`).getTime();
  const B = new Date(`${b}T12:00:00`).getTime();
  return Math.round((B - A) / 86400000);
}

/** Call after a successful payment approval. */
export function bumpGamifyOnApproval(): GamifyPersisted {
  const cur = readGamify();
  const today = todayIso();

  let streak = 1;
  if (!cur.lastApprovalDate) {
    streak = 1;
  } else if (cur.lastApprovalDate === today) {
    streak = Math.max(1, cur.streakDays);
  } else {
    const gap = daysBetween(cur.lastApprovalDate, today);
    streak = gap === 1 ? cur.streakDays + 1 : 1;
  }

  const points = cur.points + 120;
  const achievements = new Set(cur.achievements);
  achievements.add("first_quest");
  if (streak >= 3) achievements.add("week_warrior");
  if (streak >= 7) achievements.add("streak_flame");

  const next: GamifyPersisted = {
    ...cur,
    points,
    streakDays: streak,
    lastApprovalDate: today,
    achievements: [...achievements],
  };
  writeGamify(next);
  return next;
}

export function levelFromPoints(points: number): { level: number; title: string } {
  const level = Math.min(10, 1 + Math.floor(points / 500));
  const titles = [
    "Rookie Saver",
    "Smart Spender",
    "Budget Bard",
    "Coin Crusader",
    "Vault Hero",
    "Sage Saver",
    "Gold Guardian",
    "Treasure Tamer",
    "Frugal Legend",
    "Mythic Saver",
  ];
  return { level, title: titles[level - 1] ?? "Rookie Saver" };
}
