/**
 * Gamify UI motion — Tailwind-friendly class fragments (no Framer dependency).
 * Progressive enhancement: layout works without these classes.
 */

export const motion = {
  cardHover:
    "transition-transform duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[3px_3px_0_0_#000]",
  pressable: "active:scale-[0.98] transition-transform duration-150",
  barFill: "transition-[width] duration-700 ease-out",
  pulseUrgent: "animate-pulse",
  skeleton: "animate-pulse rounded-lg bg-stitch-border/40",
} as const;

export const confettiPieceClass =
  "pointer-events-none absolute text-lg opacity-0 [animation:stitch-confetti_900ms_ease-out_forwards]";

/** Inject once per document (idempotent). */
export function ensureGamifyKeyframesStyle(): void {
  if (typeof document === "undefined") return;
  const id = "stitch-gamify-keyframes";
  if (document.getElementById(id)) return;
  const el = document.createElement("style");
  el.id = id;
  el.textContent = `
@keyframes stitch-confetti {
  0% { opacity: 1; transform: translate(0,0) rotate(0deg) scale(1); }
  100% { opacity: 0; transform: translate(var(--dx,0px), var(--dy,-80px)) rotate(220deg) scale(0.6); }
}
@keyframes stitch-shimmer {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 0.9; }
}
`;
  document.head.appendChild(el);
}
