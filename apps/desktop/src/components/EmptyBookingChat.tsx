const CHIPS = [
  { label: "Flight", prompt: "Search for flights" },
  { label: "Hotel", prompt: "Search for hotels" },
  { label: "Restaurant", prompt: "Search for restaurants" },
] as const;

type EmptyBookingChatProps = {
  onChipSelect: (text: string) => void;
};

export function EmptyBookingChat({ onChipSelect }: EmptyBookingChatProps) {
  return (
    <div className="flex min-h-[min(22rem,55vh)] flex-col items-center justify-center px-2 py-8">
      <p className="max-w-lg text-center font-body text-lg leading-snug text-stitch-secondary md:text-xl">
        Tell Stitch what to book…
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
        {CHIPS.map(({ label, prompt }) => (
          <button
            key={label}
            type="button"
            onClick={() => onChipSelect(prompt)}
            className="rounded-full bg-stitch-tertiary px-3 py-1.5 font-body text-xs font-semibold text-white shadow-sm ring-1 ring-stitch-secondary/25 transition hover:opacity-95"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
