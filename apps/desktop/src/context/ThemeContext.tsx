import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export const THEME_LS_MODE = "stitch_theme_mode";
export const THEME_LS_PRIMARY = "stitch_theme_primary";
export const THEME_LS_SECONDARY = "stitch_theme_secondary";

export type ThemeMode = "light" | "dark";

export type ThemePresetId = "teal" | "sage" | "slate" | "warmSand";

export type ThemeState = {
  mode: ThemeMode;
  primary: string;
  secondary: string;
};

const PRESETS: Record<ThemePresetId, Pick<ThemeState, "primary" | "secondary">> = {
  teal: { primary: "#1A6D6F", secondary: "#C46D5E" },
  sage: { primary: "#6B8F71", secondary: "#4A7A5C" },
  slate: { primary: "#4A5D6B", secondary: "#7C8B96" },
  warmSand: { primary: "#C49A6C", secondary: "#A87B4B" },
};

export const DEFAULT_THEME: ThemeState = {
  mode: "dark",
  primary: "#00e0ff",
  secondary: "#464950",
};

const LIGHT_SEM = {
  bg: "#F5F2EB",
  surface: "#FFFBFA",
  border: "#E8E6E1",
  text: "#2C2C2C",
  textMuted: "#6B6B6B",
  placeholder: "#9E9E9E",
} as const;

/** Architectural Noir — aligns with desktop index.css when mode is dark */
const DARK_SEM = {
  bg: "#111317",
  surface: "#1e2024",
  border: "#000000",
  text: "#e2e2e8",
  textMuted: "#bac9cd",
  placeholder: "#3b494c",
} as const;

const SUCCESS = "#6B8F71";
const WARNING = "#E8A848";
const ERROR = "#4A4A4A";

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.trim().replace(/^#/, "");
  if (h.length === 3) {
    const r = parseInt(h[0]! + h[0]!, 16);
    const g = parseInt(h[1]! + h[1]!, 16);
    const b = parseInt(h[2]! + h[2]!, 16);
    if ([r, g, b].some(Number.isNaN)) return null;
    return { r, g, b };
  }
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return null;
  return { r, g, b };
}

function toHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Darken / lighten by factor in 0–1 (multiply RGB toward black or white). */
function adjustHex(hex: string, factor: number): string {
  const p = parseHex(hex);
  if (!p) return hex;
  if (factor < 1) {
    return toHex(p.r * factor, p.g * factor, p.b * factor);
  }
  const f = factor - 1;
  return toHex(p.r + (255 - p.r) * f, p.g + (255 - p.g) * f, p.b + (255 - p.b) * f);
}

function mixHex(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  if (!pa || !pb) return a;
  return toHex(pa.r + (pb.r - pa.r) * t, pa.g + (pb.g - pa.g) * t, pa.b + (pb.b - pa.b) * t);
}

function contrastTextFor(bgHex: string): string {
  const p = parseHex(bgHex);
  if (!p) return "#001f25";
  const luminance = (0.2126 * p.r + 0.7152 * p.g + 0.0722 * p.b) / 255;
  return luminance > 0.62 ? "#0f1720" : "#f8fafc";
}

/** Companion accent when user only picks a custom primary. */
export function partnerSecondaryFromPrimary(primaryHex: string): string {
  const p = parseHex(primaryHex);
  if (!p) return PRESETS.teal.secondary;
  const darker = adjustHex(primaryHex, 0.78);
  const warmer = mixHex(darker, "#C46D5E", 0.22);
  return warmer;
}

function actionButtonFill(primary: string, mode: ThemeMode): string {
  if (mode === "dark") {
    return mixHex(adjustHex(primary, 0.55), "#f5f5f5", 0.35);
  }
  return mixHex(primary, "#0a0a0a", 0.72);
}

function neutralTint(primary: string, bg: string): string {
  return mixHex(bg, primary, 0.14);
}

function tertiaryTint(primary: string, secondary: string, surface: string): string {
  return mixHex(surface, mixHex(primary, secondary, 0.5), 0.22);
}

export function applyThemeToDocument(state: ThemeState): void {
  const root = document.documentElement;
  root.dataset.theme = state.mode;
  root.style.colorScheme = state.mode;

  const sem = state.mode === "dark" ? DARK_SEM : LIGHT_SEM;
  const primaryHover = adjustHex(state.primary, 0.88);
  const secondaryHover = adjustHex(state.secondary, 0.88);
  const action = actionButtonFill(state.primary, state.mode);
  const actionHover = adjustHex(action, 0.9);
  const neutral = neutralTint(state.primary, sem.bg);
  const tertiary = tertiaryTint(state.primary, state.secondary, sem.surface);
  const primaryContainer = state.primary;
  const onPrimaryFixed = contrastTextFor(primaryContainer);
  const frameBorder = mixHex(state.secondary, "#000000", state.mode === "dark" ? 0.5 : 0.35);
  const gridLine = mixHex(primaryContainer, sem.bg, 0.62);
  const halftoneDot = mixHex(state.secondary, sem.bg, 0.35);
  const link = mixHex(primaryContainer, "#ffffff", state.mode === "dark" ? 0.18 : 0);
  const linkHover = adjustHex(link, state.mode === "dark" ? 1.15 : 0.8);

  const set = (k: string, v: string) => root.style.setProperty(k, v);

  set("--app-bg", sem.bg);
  set("--app-surface", sem.surface);
  set("--app-border", sem.border);
  set("--app-text", sem.text);
  set("--app-text-muted", sem.textMuted);
  set("--app-placeholder", sem.placeholder);

  set("--app-primary", state.primary);
  set("--app-primary-hover", primaryHover);
  set("--app-secondary", state.secondary);
  set("--app-secondary-hover", secondaryHover);
  set("--app-action", action);
  set("--app-action-hover", actionHover);
  set("--app-neutral", neutral);
  set("--app-tertiary", tertiary);
  set("--app-success", SUCCESS);
  set("--app-warning", WARNING);
  set("--app-error", ERROR);

  /* Tailwind @theme bridge */
  set("--color-stitch-surface", sem.bg);
  set("--color-stitch-card", sem.surface);
  set("--color-stitch-border", sem.border);
  /* Body / supporting text */
  set("--color-stitch-text", sem.textMuted);
  /* Headings & high-emphasis labels (was stitch-action text) */
  set("--color-stitch-heading", sem.text);
  /* Primary CTA / dark buttons (bg-stitch-action + text-white) */
  set("--color-stitch-action", action);
  set("--color-stitch-muted", sem.textMuted);
  set("--color-stitch-placeholder", sem.placeholder);
  set("--color-stitch-primary", state.primary);
  set("--color-stitch-secondary", state.secondary);
  set("--color-stitch-neutral", neutral);
  set("--color-stitch-tertiary", tertiary);
  set("--color-stitch-success", SUCCESS);
  set("--color-stitch-warning", WARNING);
  set("--color-stitch-error", ERROR);

  /* Architectural Noir fills (readable on primary-container) */
  set("--color-stitch-primary-container", primaryContainer);
  set("--color-stitch-on-primary-fixed", onPrimaryFixed);
  set("--color-stitch-surface-lowest", state.mode === "dark" ? "#0c0e12" : sem.bg);
  set("--color-stitch-surface-low", state.mode === "dark" ? "#1a1c20" : sem.surface);
  set("--color-stitch-elevated", state.mode === "dark" ? "#282a2e" : sem.surface);
  set("--color-stitch-variant", mixHex(sem.surface, state.secondary, 0.3));
  set("--color-stitch-topbar", state.mode === "dark" ? "#18181b" : sem.surface);
  set("--color-stitch-surface-secondary", mixHex(sem.surface, state.secondary, 0.55));
  set("--color-black", frameBorder);
  set("--stitch-shadow-color", frameBorder);
  set("--stitch-grid-line", gridLine);
  set("--stitch-halftone-dot", halftoneDot);
  set("--stitch-link", link);
  set("--stitch-link-hover", linkHover);
}

function readLocalStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function normalizeHex(raw: string, fallback: string): string {
  let h = raw.trim();
  if (!h) return fallback;
  if (!h.startsWith("#")) h = `#${h}`;
  if (h.length === 4) {
    const a = h[1]!;
    const b = h[2]!;
    const c = h[3]!;
    h = `#${a}${a}${b}${b}${c}${c}`;
  }
  const p = parseHex(h);
  return p ? h.toUpperCase() : fallback;
}

export function loadThemeFromStorage(): ThemeState {
  if (typeof window === "undefined") return DEFAULT_THEME;
  const modeRaw = readLocalStorage(THEME_LS_MODE);
  const mode: ThemeMode = modeRaw === "dark" ? "dark" : "light";
  const primaryRaw = readLocalStorage(THEME_LS_PRIMARY)?.trim() || DEFAULT_THEME.primary;
  const secondaryRaw = readLocalStorage(THEME_LS_SECONDARY)?.trim() || DEFAULT_THEME.secondary;
  return {
    mode,
    primary: normalizeHex(primaryRaw, DEFAULT_THEME.primary),
    secondary: normalizeHex(secondaryRaw, DEFAULT_THEME.secondary),
  };
}

function persistTheme(state: ThemeState): void {
  writeLocalStorage(THEME_LS_MODE, state.mode);
  writeLocalStorage(THEME_LS_PRIMARY, state.primary);
  writeLocalStorage(THEME_LS_SECONDARY, state.secondary);
}

type ThemeContextValue = {
  committed: ThemeState;
  commit: (state: ThemeState) => void;
  /** Live preview (does not persist). */
  applyPreview: (state: ThemeState) => void;
  /** Re-apply last saved theme to the document. */
  clearPreview: () => void;
  setMode: (mode: ThemeMode) => void;
  setPrimaryColor: (color: string) => void;
  setSecondaryColor: (color: string) => void;
  applyPreset: (preset: ThemePresetId) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [committed, setCommitted] = useState<ThemeState>(() => loadThemeFromStorage());
  const committedRef = useRef(committed);
  committedRef.current = committed;

  useLayoutEffect(() => {
    applyThemeToDocument(committed);
  }, [committed]);

  const commit = useCallback((next: ThemeState) => {
    const normalized: ThemeState = {
      mode: next.mode,
      primary: normalizeHex(next.primary, DEFAULT_THEME.primary),
      secondary: normalizeHex(next.secondary, DEFAULT_THEME.secondary),
    };
    committedRef.current = normalized;
    persistTheme(normalized);
    setCommitted(normalized);
    applyThemeToDocument(normalized);
  }, []);

  const applyPreview = useCallback((state: ThemeState) => {
    applyThemeToDocument(state);
  }, []);

  const clearPreview = useCallback(() => {
    applyThemeToDocument(committedRef.current);
  }, []);

  const setMode = useCallback(
    (mode: ThemeMode) => {
      commit({ ...committedRef.current, mode });
    },
    [commit],
  );

  const setPrimaryColor = useCallback(
    (color: string) => {
      commit({ ...committedRef.current, primary: color });
    },
    [commit],
  );

  const setSecondaryColor = useCallback(
    (color: string) => {
      commit({ ...committedRef.current, secondary: color });
    },
    [commit],
  );

  const applyPreset = useCallback(
    (preset: ThemePresetId) => {
      const { primary, secondary } = PRESETS[preset];
      commit({ ...committedRef.current, primary, secondary });
    },
    [commit],
  );

  const value = useMemo(
    () => ({
      committed,
      commit,
      applyPreview,
      clearPreview,
      setMode,
      setPrimaryColor,
      setSecondaryColor,
      applyPreset,
    }),
    [committed, commit, applyPreview, clearPreview, setMode, setPrimaryColor, setSecondaryColor, applyPreset],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}

export function presetList(): Array<{ id: ThemePresetId; label: string }> {
  return [
    { id: "teal", label: "Teal (default)" },
    { id: "sage", label: "Sage" },
    { id: "slate", label: "Slate" },
    { id: "warmSand", label: "Warm sand" },
  ];
}

export { PRESETS };
