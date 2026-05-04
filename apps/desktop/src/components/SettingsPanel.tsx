import { useState } from "react";
import type { VoiceFaceSettings } from "../fixtures/subscriptions";
import { SettingsToggleRow } from "./SettingsToggleRow";

export function SettingsPanel({
  settings,
  onToggleSetting,
  accountEmailDraft,
  onAccountEmailDraftChange,
  onAccountEmailCommit,
}: {
  settings: VoiceFaceSettings;
  onToggleSetting: <K extends keyof VoiceFaceSettings>(key: K, value: VoiceFaceSettings[K]) => void;
  accountEmailDraft: string;
  onAccountEmailDraftChange: (email: string) => void;
  onAccountEmailCommit: () => void;
}) {
  const [savedFlash, setSavedFlash] = useState(false);

  function flashSaved() {
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 2000);
  }

  return (
    <section className="noir-card-sm p-4">
      <p className="font-display text-base font-bold text-stitch-heading">Account & automation</p>
      <div className="mt-3 space-y-3">
        <div className="rounded-lg border border-stitch-border bg-stitch-surface/60 p-3">
          <label className="font-body text-xs font-semibold text-stitch-muted">
            Account email (demo — localStorage)
            <input
              type="text"
              inputMode="email"
              autoComplete="email"
              spellCheck={false}
              value={accountEmailDraft}
              onChange={(e) => onAccountEmailDraftChange(e.target.value)}
              onBlur={() => {
                onAccountEmailCommit();
                flashSaved();
              }}
              placeholder="you@example.com"
              className="mt-2 w-full rounded border border-stitch-border bg-stitch-card px-2 py-2 font-body text-sm text-stitch-heading placeholder:text-stitch-placeholder"
            />
          </label>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onAccountEmailCommit();
                flashSaved();
              }}
              className="noir-cmd-primary rounded px-3 py-1.5 font-body text-xs"
            >
              Save email
            </button>
            {savedFlash ? <span className="font-body text-xs font-medium text-stitch-success">Saved to this browser.</span> : null}
          </div>
          <p className="mt-1 font-body text-[11px] text-stitch-muted">
            Used for face enrollment and the doc brain. Key: <code className="rounded bg-stitch-tertiary px-1">stitch.userEmail</code>
          </p>
        </div>
        <SettingsToggleRow label="Face MFA" checked={settings.faceMfa} onToggle={(next) => onToggleSetting("faceMfa", next)} />
        <div className="rounded-lg border border-stitch-border bg-stitch-surface/60 p-3">
          <label className="font-body text-xs font-semibold text-stitch-muted">
            Auto-approve under
            <select
              value={settings.autoApproveUnderUsd == null ? "off" : String(settings.autoApproveUnderUsd)}
              onChange={(event) => onToggleSetting("autoApproveUnderUsd", event.target.value === "off" ? null : Number(event.target.value))}
              className="mt-2 w-full rounded border border-stitch-border bg-stitch-card px-2 py-2 font-body text-sm text-stitch-heading"
            >
              <option value="5">$5</option>
              <option value="10">$10</option>
              <option value="20">$20</option>
              <option value="off">Off</option>
            </select>
          </label>
        </div>
      </div>
    </section>
  );
}
