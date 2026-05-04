import { useEffect, useState } from "react";

type RagStitchView = {
  state: string;
  answer: string;
  confidence: string;
  source_cards: Array<{
    rank?: number;
    source_id?: string;
    score?: number | null;
    snippet?: string;
  }>;
  show_sources?: boolean;
  debug_retrieval_cards?: Array<{
    rank?: number;
    source_id?: string;
    score?: number | null;
    snippet?: string;
  }>;
};

export type RagVoiceRunRequest = { id: number; query: string };

/**
 * Optional local "document brain": POST /api/rag/stitch proxied to
 * cursor_linkup_mcp stitch_rag_bridge.py (default http://127.0.0.1:8765).
 */
export function LinkupRagPanel({ voiceRunRequest }: { voiceRunRequest?: RagVoiceRunRequest | null }) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RagStitchView | null>(null);

  async function runQuery(override?: string) {
    const trimmed = (override ?? query).trim();
    if (!trimmed) return;
    setQuery(trimmed);
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/rag/stitch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
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

  useEffect(() => {
    if (!voiceRunRequest?.query.trim()) return;
    void runQuery(voiceRunRequest.query);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when voice intent id changes
  }, [voiceRunRequest?.id]);

  return (
    <section id="stitch-linkup-rag" className="noir-card p-4">
      <p className="font-display text-base font-semibold text-stitch-heading">Local document brain</p>
      <p className="mt-1 font-body text-xs text-stitch-secondary">
        Runs PDF RAG via the Linkup MCP bridge. Start{" "}
        <code className="rounded bg-stitch-neutral/30 px-1 py-0.5 text-[11px]">stitch_rag_bridge.py</code> in{" "}
        <code className="rounded bg-stitch-neutral/30 px-1 py-0.5 text-[11px]">cursor_linkup_mcp</code> first.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask about your PDF corpus…"
          className="min-w-0 flex-1 rounded-xl border border-stitch-secondary/40 bg-stitch-card px-3 py-2 font-body text-sm text-stitch-heading placeholder:text-stitch-placeholder"
        />
        <button
          type="button"
          onClick={() => void runQuery()}
          disabled={loading || !query.trim()}
          className="noir-cmd-primary rounded px-4 py-2 font-body text-xs disabled:opacity-50"
        >
          {loading ? "Thinking…" : "Ask"}
        </button>
      </div>
      {error ? (
        <p className="mt-3 rounded border border-stitch-error/50 bg-stitch-error/10 p-3 font-body text-xs text-stitch-error">
          {error}
        </p>
      ) : null}
      {result ? (
        <div className="mt-3 space-y-2 rounded-xl bg-stitch-neutral/20 p-3">
          <p className="font-body text-[11px] font-semibold uppercase tracking-wide text-stitch-secondary">
            {result.state} · {result.confidence}
          </p>
          <p className="font-body text-sm text-stitch-heading">{result.answer}</p>
          {result.show_sources && result.source_cards?.length ? (
            <ul className="mt-2 space-y-2 border-stitch-neutral/40 border-t pt-2">
              {result.source_cards.map((c, i) => (
                <li key={`${c.source_id}-${i}`} className="font-body text-xs text-stitch-secondary">
                  <span className="font-semibold text-stitch-heading">{c.source_id}</span>
                  {typeof c.score === "number" ? ` · score ${c.score.toFixed(3)}` : null}
                  <p className="mt-1 text-stitch-secondary/90">{c.snippet}</p>
                </li>
              ))}
            </ul>
          ) : null}
          {result.debug_retrieval_cards?.length ? (
            <details className="mt-2 font-body text-xs text-stitch-secondary">
              <summary className="cursor-pointer font-semibold text-stitch-heading">Debug retrieval</summary>
              <ul className="mt-2 space-y-2">
                {result.debug_retrieval_cards.map((c, i) => (
                  <li key={`dbg-${c.source_id}-${i}`}>
                    <span className="font-semibold">{c.source_id}</span> · {c.snippet}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
