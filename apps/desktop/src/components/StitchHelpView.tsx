import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { RagStitchPostBody, RagStitchView } from "stitch-api-types";

function formatInline(text: string): ReactNode {
  const parts = text.split(/`([^`]+)`/);
  if (parts.length === 1) return text;
  return parts.map((p, idx) =>
    idx % 2 === 1 ? (
      <code key={idx} className="rounded bg-stitch-neutral/30 px-1 py-0.5 font-mono text-[11px] text-stitch-heading">
        {p}
      </code>
    ) : (
      <span key={idx}>{p}</span>
    ),
  );
}

function MarkdownLite({ source }: { source: string }) {
  const nodes = useMemo(() => {
    const lines = source.replace(/\r\n/g, "\n").split("\n");
    const out: ReactNode[] = [];
    let k = 0;
    const key = () => {
      k += 1;
      return `md-${k}`;
    };
    const listItems: string[] = [];
    const flushList = () => {
      if (!listItems.length) return;
      out.push(
        <ul key={key()} className="mt-2 list-disc space-y-1 pl-5 font-body text-sm text-stitch-text">
          {listItems.map((t, j) => (
            <li key={j}>{formatInline(t.replace(/^[-*]\s+/, ""))}</li>
          ))}
        </ul>,
      );
      listItems.length = 0;
    };

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === "") {
        flushList();
        continue;
      }
      if (/^[-*]\s+/.test(trimmed)) {
        listItems.push(trimmed);
        continue;
      }
      flushList();
      if (trimmed.startsWith("### ")) {
        out.push(
          <h3 key={key()} className="mt-4 font-display text-sm font-bold text-stitch-heading">
            {trimmed.slice(4)}
          </h3>,
        );
      } else if (trimmed.startsWith("## ")) {
        out.push(
          <h2 key={key()} className="mt-6 font-display text-base font-bold text-stitch-heading">
            {trimmed.slice(3)}
          </h2>,
        );
      } else if (trimmed.startsWith("# ")) {
        out.push(
          <h1 key={key()} className="mt-2 font-display text-lg font-bold text-stitch-heading">
            {trimmed.slice(2)}
          </h1>,
        );
      } else if (trimmed === "---") {
        out.push(<hr key={key()} className="my-4 border-stitch-border" />);
      } else {
        out.push(
          <p key={key()} className="mt-2 font-body text-sm leading-relaxed text-stitch-text">
            {formatInline(trimmed)}
          </p>,
        );
      }
    }
    flushList();
    return out;
  }, [source]);

  return <div className="space-y-0">{nodes}</div>;
}

function StitchSupportAssistant() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RagStitchView | null>(null);

  async function runAsk() {
    const trimmed = query.trim();
    if (!trimmed) return;
    setQuery(trimmed);
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/rag/stitch-help", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed } satisfies RagStitchPostBody),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
      }
      const data = (await res.json()) as RagStitchView;
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="noir-card p-4">
      <h2 className="font-display text-base font-semibold text-stitch-heading">Ask Stitch</h2>
      <p className="mt-1 font-body text-xs text-stitch-secondary">
        Answers use only the bundled user guide and local Ollama on the bridge machine—not your PDF document brain.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. What does Check due payments now do?"
          className="min-w-0 flex-1 rounded-xl border border-stitch-secondary/40 bg-stitch-card px-3 py-2 font-body text-sm text-stitch-heading placeholder:text-stitch-placeholder"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void runAsk();
            }
          }}
        />
        <button
          type="button"
          onClick={() => void runAsk()}
          disabled={loading || !query.trim()}
          className="noir-cmd-primary rounded px-4 py-2 font-body text-xs disabled:opacity-50"
        >
          {loading ? "Thinking…" : "Ask"}
        </button>
      </div>
      {error ? (
        <p className="mt-3 rounded border border-stitch-error/50 bg-stitch-error/10 p-3 font-body text-xs text-stitch-error">{error}</p>
      ) : null}
      {result ? (
        <div className="mt-3 space-y-2 rounded-xl bg-stitch-neutral/20 p-3">
          <p className="font-body text-[11px] font-semibold uppercase tracking-wide text-stitch-secondary">
            {result.state} · {result.confidence}
          </p>
          <p className="font-body text-sm text-stitch-heading">{result.answer}</p>
          {result.show_sources && result.source_cards?.length ? (
            <ul className="mt-2 space-y-1 border-stitch-neutral/40 border-t pt-2">
              {result.source_cards.map((c, i) => (
                <li key={`${c.source_id}-${i}`} className="font-body text-xs text-stitch-secondary">
                  <span className="font-semibold text-stitch-heading">{c.source_id}</span>
                  {c.snippet ? <span className="mt-0.5 block text-stitch-secondary/90">{c.snippet}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function StitchHelpView() {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [guideErr, setGuideErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/stitch-user-guide");
        const data = (await res.json()) as { markdown?: string; error?: string };
        if (cancelled) return;
        if (!res.ok || !(data.markdown ?? "").trim()) {
          setGuideErr(
            data.error === "missing_guide"
              ? "The bridge is running but docs/stitch_user_guide.md was not found on the server."
              : "Could not load the user guide from the bridge.",
          );
          setMarkdown("");
          return;
        }
        setMarkdown(data.markdown ?? "");
        setGuideErr(null);
      } catch {
        if (!cancelled) {
          setGuideErr("Could not reach the bridge (start stitch_rag_bridge.py or the bundled GUI).");
          setMarkdown("");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6 pb-8">
      <StitchSupportAssistant />
      <section className="noir-card p-4">
        <h2 className="font-display text-base font-semibold text-stitch-heading">User guide</h2>
        <p className="mt-1 font-body text-xs text-stitch-secondary">Same content the assistant is allowed to quote.</p>
        {guideErr ? <p className="mt-2 font-body text-xs text-stitch-error">{guideErr}</p> : null}
        {markdown === null ? (
          <p className="mt-3 font-body text-sm text-stitch-secondary">Loading guide…</p>
        ) : markdown ? (
          <div className="mt-3 max-h-[55vh] overflow-y-auto overscroll-y-contain pr-1">
            <MarkdownLite source={markdown} />
          </div>
        ) : (
          <p className="mt-3 font-body text-sm text-stitch-secondary">No guide text returned.</p>
        )}
      </section>
    </div>
  );
}
