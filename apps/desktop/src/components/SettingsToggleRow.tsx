/** Shared settings row — toggle switch + label. */
export function SettingsToggleRow({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-stitch-border bg-stitch-surface/60 p-3">
      <p className="font-body text-sm font-medium text-stitch-heading">{label}</p>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onToggle(!checked)}
        className={`relative h-8 w-14 rounded-full transition-colors duration-200 ${checked ? "bg-stitch-success" : "bg-stitch-tertiary"}`}
      >
        <span
          className={`absolute top-1 left-1 h-6 w-6 rounded-full bg-white shadow transition-transform duration-200 ${checked ? "translate-x-6" : ""}`}
        />
        <span className="sr-only">{label}</span>
      </button>
    </div>
  );
}
