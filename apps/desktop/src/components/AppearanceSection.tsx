import { useEffect, useState } from "react";
import {
  type ThemePresetId,
  type ThemeState,
  partnerSecondaryFromPrimary,
  presetList,
  PRESETS,
  useTheme,
} from "../context/ThemeContext";

export function AppearanceSection() {
  const { committed, commit, applyPreview, clearPreview } = useTheme();
  const [draft, setDraft] = useState<ThemeState>(committed);
  const [customSecondaryTouched, setCustomSecondaryTouched] = useState(false);

  useEffect(() => {
    setDraft(committed);
    setCustomSecondaryTouched(false);
  }, [committed]);

  useEffect(() => {
    applyPreview(draft);
    return () => clearPreview();
  }, [draft, applyPreview, clearPreview]);

  function applyPresetToDraft(id: ThemePresetId) {
    const { primary, secondary } = PRESETS[id];
    setCustomSecondaryTouched(false);
    setDraft((d) => ({ ...d, primary, secondary }));
  }

  function save() {
    commit(draft);
  }

  function discard() {
    setDraft(committed);
    clearPreview();
  }

  const dirty =
    draft.mode !== committed.mode ||
    draft.primary.toLowerCase() !== committed.primary.toLowerCase() ||
    draft.secondary.toLowerCase() !== committed.secondary.toLowerCase();

  return (
    <section className="noir-card p-4">
      <p className="font-display text-base font-semibold text-stitch-heading">Appearance</p>
      <p className="mt-1 font-body text-[11px] text-stitch-muted">
        Preview updates live. Save to persist to this browser, or discard to revert the preview.
      </p>

      <div className="mt-4 space-y-4">
        <div>
          <p className="font-body text-xs font-semibold text-stitch-muted">Mode</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(["light", "dark"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setDraft((d) => ({ ...d, mode: m }))}
                className={
                  draft.mode === m
                    ? "noir-cmd-primary rounded px-4 py-1.5 font-body text-xs"
                    : "rounded border border-stitch-border bg-stitch-tertiary px-4 py-1.5 font-body text-xs font-semibold text-stitch-heading hover:bg-[#2a2c32]"
                }
              >
                {m === "light" ? "Light" : "Dark"}
              </button>
            ))}
          </div>
          <p className="mt-3 font-body text-[11px] leading-relaxed text-stitch-muted">
            <span className="font-semibold text-stitch-heading">Theme note.</span> Architectural Noir is
            designed as a dark-first theme. Light mode is available but may have contrast issues with black
            borders and heavy shadows. Recommended experience: Dark Mode.
          </p>
        </div>

        <div>
          <p className="font-body text-xs font-semibold text-stitch-muted">Color presets</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {presetList().map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => applyPresetToDraft(id)}
                className="rounded border border-stitch-border bg-stitch-tertiary px-3 py-1.5 font-body text-[11px] font-semibold text-stitch-heading hover:bg-[#2a2c32]"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="noir-card-sm p-3">
          <p className="font-body text-xs font-semibold text-stitch-muted">Custom accents</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <label className="block font-body text-[11px] text-stitch-muted">
              Primary accent
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="color"
                  value={draft.primary}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDraft((d) => ({
                      ...d,
                      primary: v,
                      secondary: customSecondaryTouched ? d.secondary : partnerSecondaryFromPrimary(v),
                    }));
                  }}
                  className="h-9 w-14 cursor-pointer rounded border border-stitch-border bg-stitch-card"
                />
                <input
                  type="text"
                  spellCheck={false}
                  value={draft.primary}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDraft((d) => ({
                      ...d,
                      primary: v,
                      secondary: customSecondaryTouched ? d.secondary : partnerSecondaryFromPrimary(v),
                    }));
                  }}
                  className="min-w-0 flex-1 rounded border border-stitch-border bg-stitch-card px-2 py-1.5 font-mono text-xs text-stitch-heading placeholder:text-stitch-placeholder"
                  placeholder="#00daf8"
                />
              </div>
            </label>
            <label className="block font-body text-[11px] text-stitch-muted">
              Secondary accent
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="color"
                  value={draft.secondary}
                  onChange={(e) => {
                    setCustomSecondaryTouched(true);
                    setDraft((d) => ({ ...d, secondary: e.target.value }));
                  }}
                  className="h-9 w-14 cursor-pointer rounded border border-stitch-border bg-stitch-card"
                />
                <input
                  type="text"
                  spellCheck={false}
                  value={draft.secondary}
                  onChange={(e) => {
                    setCustomSecondaryTouched(true);
                    setDraft((d) => ({ ...d, secondary: e.target.value }));
                  }}
                  className="min-w-0 flex-1 rounded border border-stitch-border bg-stitch-card px-2 py-1.5 font-mono text-xs text-stitch-heading placeholder:text-stitch-placeholder"
                  placeholder="#334155"
                />
              </div>
            </label>
          </div>
          <p className="mt-2 font-body text-[10px] text-stitch-muted">
            Changing primary updates the secondary suggestion until you edit secondary yourself.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-stitch-border/40 pt-3">
          <button
            type="button"
            disabled={!dirty}
            onClick={save}
            className="noir-cmd-primary rounded px-4 py-2 font-body text-xs disabled:opacity-40"
          >
            Save appearance
          </button>
          <button
            type="button"
            disabled={!dirty}
            onClick={discard}
            className="rounded border border-stitch-border bg-stitch-card px-4 py-2 font-body text-xs font-semibold text-stitch-heading disabled:opacity-40"
          >
            Discard preview
          </button>
        </div>
      </div>
    </section>
  );
}
