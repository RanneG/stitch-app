/**
 * Pure voice intent matching for Stitch (Web Speech transcripts).
 * Kept in one module so it can move into a shared desktop library later.
 */
import type { SubscriptionItem } from "../fixtures/subscriptions";

export type StitchVoiceCommand =
  | { type: "open_rag" }
  | { type: "open_help" }
  | { type: "open_settings" }
  | { type: "open_account" }
  | { type: "open_voice" }
  | { type: "open_alerts" }
  | { type: "open_face" }
  | { type: "open_appearance" }
  | { type: "open_billing" }
  | { type: "open_history" }
  | { type: "open_upcoming" }
  | { type: "scan_gmail" }
  | { type: "rag_query"; query: string }
  | { type: "set_theme"; mode: "light" | "dark" }
  | { type: "toggle_theme" }
  | { type: "pay_subscription"; nameQuery: string };

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/** Strip common filler so “pay for the Netflix subscription” → “netflix”. */
function cleanSubscriptionNameQuery(raw: string): string {
  return raw
    .replace(/\s+subscription$/i, "")
    .replace(/^(?:the|a|an|my|our)\s+/i, "")
    .trim();
}

/**
 * Best-effort match of a spoken service name to a **pending** subscription row.
 */
export function matchSubscriptionByVoiceQuery(subscriptions: SubscriptionItem[], rawQuery: string): SubscriptionItem | null {
  const q = cleanSubscriptionNameQuery(rawQuery).toLowerCase();
  if (q.length < 2) return null;
  const pending = subscriptions.filter((s) => s.status === "pending");
  if (pending.length === 0) return null;

  for (const s of pending) {
    const n = s.name.trim().toLowerCase();
    if (n === q) return s;
  }
  for (const s of pending) {
    const n = s.name.trim().toLowerCase();
    if (n.includes(q) || q.includes(n)) return s;
  }
  for (const s of pending) {
    const n = s.name.trim().toLowerCase();
    for (const w of q.split(/\s+/)) {
      if (w.length >= 3 && n.includes(w)) return s;
    }
  }
  return null;
}

/**
 * Map a speech transcript to a command. Does not handle "approve" — the UI
 * should treat approval only when a payment is pending.
 */
export function matchStitchVoiceCommand(raw: string): StitchVoiceCommand | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const t = norm(trimmed);

  if (/\b(?:toggle|switch)\s+(?:the\s+)?(?:color\s+)?theme\b/i.test(t)) {
    return { type: "toggle_theme" };
  }
  const themeSetTo =
    /\b(?:switch|change|set)\s+to\s+(dark|light)(?:\s+(?:mode|theme|appearance))?\b/i.exec(t) ||
    /\b(?:switch|change)\s+to\s+(dark|light)\b/i.exec(t);
  if (themeSetTo?.[1]) {
    const m = themeSetTo[1].toLowerCase();
    return { type: "set_theme", mode: m === "dark" ? "dark" : "light" };
  }
  const themeUse = /\b(?:use|enable|turn\s+on)\s+(dark|light)(?:\s+(?:mode|theme))?\b/i.exec(t);
  if (themeUse?.[1]) {
    const m = themeUse[1].toLowerCase();
    return { type: "set_theme", mode: m === "dark" ? "dark" : "light" };
  }
  if (/^(?:set\s+)?(dark|light)\s+mode$/i.test(trimmed)) {
    const m = /^(?:set\s+)?(dark|light)\s+mode$/i.exec(trimmed);
    if (m?.[1]) return { type: "set_theme", mode: m[1].toLowerCase() === "dark" ? "dark" : "light" };
  }

  const payApprove = /^(?:approve\s+payment\s+for)\s+(.{2,120})$/i.exec(trimmed);
  if (payApprove?.[1]) {
    const namePart = cleanSubscriptionNameQuery(payApprove[1]);
    if (namePart.length >= 2) return { type: "pay_subscription", nameQuery: namePart };
  }
  const payFor = /^(?:pay\s+for|pay|demo\s+pay)\s+(.{2,120})$/i.exec(trimmed);
  if (payFor?.[1]) {
    const namePart = cleanSubscriptionNameQuery(payFor[1]);
    if (namePart.length >= 2) return { type: "pay_subscription", nameQuery: namePart };
  }

  const ragAsk =
    /^(?:ask|query)\s+(?:my\s+)?(?:the\s+)?(?:pdf|pdfs|document|documents|docs|corpus)\s+(?:about\s+)?(.{2,800})/i.exec(trimmed);
  if (ragAsk?.[1]) {
    const q = ragAsk[1].trim();
    if (q.length >= 2) return { type: "rag_query", query: q };
  }

  const ragSearch =
    /^search\s+(?:my\s+)?(?:pdf|pdfs|document|documents|docs)\s+(?:for\s+)?(.{2,800})/i.exec(trimmed);
  if (ragSearch?.[1]) {
    const q = ragSearch[1].trim();
    if (q.length >= 2) return { type: "rag_query", query: q };
  }

  if (
    /\b(scan\s+gmail|run\s+discovery|find\s+subscriptions|discover\s+subscriptions|scan\s+(?:my\s+)?(?:email|inbox))\b/i.test(
      t,
    )
  ) {
    return { type: "scan_gmail" };
  }

  if (
    /\b(open\s+(?:document\s+)?brain|open\s+rag|show\s+document\s+brain|document\s+brain|local\s+(?:document\s+)?brain)\b/i.test(t)
  ) {
    return { type: "open_rag" };
  }

  if (/\b(open\s+help|show\s+help|user\s+guide|help\s+and\s+support|help\s+tab)\b/i.test(t) || /^help$/i.test(trimmed)) {
    return { type: "open_help" };
  }

  if (/\b(go\s+to\s+billing|open(?:\s+the)?\s+billing|billing\s+tab)\b/i.test(t)) {
    return { type: "open_billing" };
  }

  if (/\b(go\s+to\s+voice|open(?:\s+the)?\s+voice|voice\s+tab|voice\s+settings|microphone\s+settings)\b/i.test(t)) {
    return { type: "open_voice" };
  }

  if (/\b(go\s+to\s+alerts|open(?:\s+the)?\s+alerts|alerts\s+tab|notifications?\s+tab)\b/i.test(t)) {
    return { type: "open_alerts" };
  }

  if (/\b(go\s+to\s+face|open(?:\s+the)?\s+face|face\s+tab|face\s+verification|face\s+mfa|mfa\s+face)\b/i.test(t)) {
    return { type: "open_face" };
  }

  if (/\b(go\s+to\s+appearance|open(?:\s+the)?\s+appearance|appearance\s+tab|open(?:\s+the)?\s+themes?|theme\s+settings)\b/i.test(t)) {
    return { type: "open_appearance" };
  }

  if (/\b(go\s+to\s+account|open(?:\s+the)?\s+account|account\s+settings|link\s+google|google\s+sign[\s-]?in)\b/i.test(t)) {
    return { type: "open_account" };
  }

  if (/\b(payment\s+history|open\s+history|go\s+to\s+history)\b/i.test(t) || /^history$/i.test(trimmed)) {
    return { type: "open_history" };
  }

  if (
    /\b(go\s+home|open\s+upcoming|open\s+dashboard|upcoming\s+renewals)\b/i.test(t) ||
    /^(upcoming|dashboard|home)$/i.test(trimmed)
  ) {
    return { type: "open_upcoming" };
  }

  if (
    /\b(open(?:\s+the)?\s+settings?|go\s+to(?:\s+the)?\s+settings?)\b/i.test(t) ||
    /^settings$/i.test(trimmed)
  ) {
    return { type: "open_settings" };
  }

  return null;
}

/** Human-readable label for settings / debug UI. */
export function describeStitchVoiceCommand(cmd: StitchVoiceCommand): string {
  switch (cmd.type) {
    case "open_rag":
      return "Open document brain (RAG)";
    case "open_help":
      return "Open Help & support";
    case "open_settings":
      return "Open Settings";
    case "open_account":
      return "Open Account";
    case "open_voice":
      return "Open Voice settings";
    case "open_alerts":
      return "Open Alerts settings";
    case "open_face":
      return "Open Face verification";
    case "open_appearance":
      return "Open Appearance settings";
    case "open_billing":
      return "Open Billing (document brain tab)";
    case "open_history":
      return "Open payment history";
    case "open_upcoming":
      return "Open Upcoming / dashboard";
    case "scan_gmail":
      return "Scan Gmail / run discovery";
    case "rag_query":
      return `Document question: “${cmd.query.slice(0, 80)}${cmd.query.length > 80 ? "…" : ""}”`;
    case "set_theme":
      return `Switch to ${cmd.mode} mode`;
    case "toggle_theme":
      return "Toggle light / dark theme";
    case "pay_subscription":
      return `Pay / approve: “${cmd.nameQuery.slice(0, 60)}${cmd.nameQuery.length > 60 ? "…" : ""}”`;
    default:
      return "Command";
  }
}
