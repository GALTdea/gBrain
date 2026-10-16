"use client";

import React, { useState } from "react";
import { Note } from "@/types/note";

export interface SourceNote {
  id: string;
  title: string;
  snippet: string;
  tags?: string[];
  score?: number;
}

interface ConversationalSearchProps {
  userId: string;
  notes: Note[];
  onOpenNote?: (noteId: string) => void;
}

export default function ConversationalSearch({
  userId,
  notes,
  onOpenNote,
}: ConversationalSearchProps) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState<string>("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [currentQuery, setCurrentQuery] = useState<string>("");
  const [sources, setSources] = useState<SourceNote[]>([]);
  const [usedVectorSearch, setUsedVectorSearch] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  // Track open/collapsed state of each individual source card
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({});

  const toggleSource = (sourceId: string) => {
    setExpandedSources((prev) => ({
      ...prev,
      [sourceId]: !prev[sourceId],
    }));
  };

  const expandAllSources = () => {
    const allExpanded: Record<string, boolean> = {};
    sources.forEach((s) => {
      allExpanded[s.id] = true;
    });
    setExpandedSources(allExpanded);
  };

  const collapseAllSources = () => {
    setExpandedSources({});
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || !userId) return;

    const submittedQuery = query.trim();
    setLoading(true);
    setLoadingStep("Embedding query with Vertex AI text-embedding-004...");
    setError(null);
    setAnswer(null);
    setSources([]);
    setCurrentQuery(submittedQuery);

    try {
      // Simulate/display real progress step
      const stepTimer = setTimeout(() => {
        setLoadingStep("Scanning Firestore subcollection (findNearest vector search)...");
      }, 500);

      const stepTimer2 = setTimeout(() => {
        setLoadingStep("Synthesizing grounded answer with Gemini 1.5 Flash...");
      }, 1000);

      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: submittedQuery,
          userId,
          localNotes: notes, // Passed to ensure immediate offline and demo mode support
        }),
      });

      clearTimeout(stepTimer);
      clearTimeout(stepTimer2);

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to query Second Brain AI");
      }

      setAnswer(data.answer);
      const returnedSources: SourceNote[] = data.sources || [];
      setSources(returnedSources);
      setUsedVectorSearch(Boolean(data.usedVectorSearch));

      // By default expand the top matching source card
      if (returnedSources.length > 0) {
        setExpandedSources({ [returnedSources[0].id]: true });
      }
    } catch (err: unknown) {
      console.error("RAG Search failed:", err);
      const message = err instanceof Error ? err.message : "Failed to search notes. Please try again.";
      setError(message);
    } finally {
      setLoading(false);
      setLoadingStep("");
    }
  };

  const handleCopyAnswer = () => {
    if (!answer) return;
    navigator.clipboard.writeText(answer).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleSuggestedPrompt = (prompt: string) => {
    setQuery(prompt);
  };

  const getScoreColor = (score?: number) => {
    if (score === undefined) return "badge-ghost";
    if (score >= 0.8) return "badge-success";
    if (score >= 0.6) return "badge-info";
    return "badge-warning";
  };

  return (
    <div className="space-y-6">
      {/* Search Header Banner */}
      <div className="card bg-base-200/50 backdrop-blur border border-primary/20 shadow-md p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center text-2xl shadow-inner">
              ✨
            </div>
            <div>
              <h2 className="text-xl font-extrabold tracking-tight flex items-center gap-2">
                Search Your Brain
                <span className="badge badge-primary badge-sm font-semibold">
                  Gemini 1.5 Flash
                </span>
              </h2>
              <p className="text-xs text-base-content/60">
                Natural language question answering grounded in your personal notes via 768-dim vector embeddings
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono text-base-content/60 self-start sm:self-auto bg-base-100/80 px-3 py-1.5 rounded-lg border border-base-300">
            <span>Model: <strong>text-embedding-004</strong></span>
            <span>•</span>
            <span className="text-secondary">k=15 nearest</span>
          </div>
        </div>

        {/* Natural Language Search Input Form */}
        <form onSubmit={handleSearch} className="space-y-3">
          <div className="relative">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-base-content/40 text-lg pointer-events-none">
              🔍
            </div>
            <input
              type="text"
              placeholder="Ask a question about your notes... (e.g., 'What are our key architecture decisions?')"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={loading}
              className="input input-bordered w-full pl-12 pr-32 py-3 bg-base-100 text-sm focus:input-primary shadow-inner rounded-xl"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
              {query && !loading && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="btn btn-ghost btn-xs btn-circle text-base-content/40 hover:text-base-content"
                  title="Clear query"
                >
                  ✕
                </button>
              )}
              <button
                type="submit"
                disabled={loading || !query.trim()}
                className="btn btn-primary btn-sm font-semibold gap-1.5 shadow rounded-lg"
              >
                {loading ? (
                  <span className="loading loading-spinner loading-xs"></span>
                ) : (
                  <>
                    <span>Ask AI</span>
                    <span className="text-xs">→</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Quick Prompt Suggestions */}
          {!loading && notes.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-base-content/60 pt-1">
              <span className="text-[11px] font-semibold text-base-content/50">Suggestions:</span>
              <button
                type="button"
                onClick={() => handleSuggestedPrompt("What are the main architecture and design decisions?")}
                className="badge badge-outline hover:badge-primary cursor-pointer text-[11px] py-2 transition-colors"
              >
                Architecture decisions
              </button>
              <button
                type="button"
                onClick={() => handleSuggestedPrompt("Summarize all notes and key concepts")}
                className="badge badge-outline hover:badge-primary cursor-pointer text-[11px] py-2 transition-colors"
              >
                Summarize all notes
              </button>
              <button
                type="button"
                onClick={() => handleSuggestedPrompt("What tasks or action items are recorded?")}
                className="badge badge-outline hover:badge-primary cursor-pointer text-[11px] py-2 transition-colors"
              >
                Action items
              </button>
            </div>
          )}
        </form>

        {/* Error Alert */}
        {error && (
          <div className="alert alert-error text-xs py-3 rounded-xl flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={() => setError(null)}
              className="btn btn-ghost btn-xs btn-circle"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Loading State Animation */}
      {loading && (
        <div className="card bg-base-200/40 border border-primary/20 p-8 text-center space-y-4 animate-in fade-in duration-200">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto shadow-sm">
            <span className="loading loading-spinner loading-md text-primary"></span>
          </div>
          <div className="space-y-1">
            <h4 className="font-bold text-sm tracking-tight text-base-content">
              Consulting Second Brain...
            </h4>
            <p className="text-xs font-mono text-primary animate-pulse">
              {loadingStep || "Processing query..."}
            </p>
          </div>
          <div className="w-full max-w-xs mx-auto">
            <progress className="progress progress-primary w-full"></progress>
          </div>
        </div>
      )}

      {/* Conversational AI Response Container */}
      {answer && !loading && (
        <div className="card bg-base-100 border border-primary/25 shadow-lg overflow-hidden animate-in fade-in duration-300">
          {/* Answer Card Top Header */}
          <div className="px-6 py-4 bg-primary/5 border-b border-base-300 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="text-xl">🧠</span>
              <div>
                <div className="font-bold text-sm text-primary flex items-center gap-2">
                  <span>AI Synthesized Answer</span>
                  <span className="badge badge-xs badge-primary font-mono">Grounded</span>
                </div>
                <div className="text-[11px] text-base-content/60 font-mono">
                  Query: &ldquo;{currentQuery}&rdquo;
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="badge badge-ghost badge-sm text-[11px] font-mono">
                {usedVectorSearch ? "⚡ Firestore findNearest" : "🔍 Cosine Ranking"}
              </span>
              <button
                type="button"
                onClick={handleCopyAnswer}
                className="btn btn-ghost btn-xs gap-1 border border-base-300 hover:btn-primary"
                title="Copy answer to clipboard"
              >
                {copied ? "✓ Copied" : "📋 Copy"}
              </button>
            </div>
          </div>

          {/* Answer Body */}
          <div className="p-6 space-y-5">
            <div className="text-sm text-base-content/90 leading-relaxed whitespace-pre-wrap font-sans bg-base-200/30 p-4 rounded-xl border border-base-300/60">
              {answer}
            </div>

            {/* Collapsible Referenced Source Notes Section */}
            {sources.length > 0 && (
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between border-b border-base-300 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-base-content/70">
                      Referenced Notes ({sources.length})
                    </span>
                    <span className="text-[11px] text-base-content/50">
                      Grounded citations &amp; semantic matches
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs">
                    <button
                      type="button"
                      onClick={expandAllSources}
                      className="btn btn-ghost btn-xs text-[11px] hover:text-primary"
                    >
                      Expand All
                    </button>
                    <span className="text-base-content/30">•</span>
                    <button
                      type="button"
                      onClick={collapseAllSources}
                      className="btn btn-ghost btn-xs text-[11px] hover:text-primary"
                    >
                      Collapse All
                    </button>
                  </div>
                </div>

                {/* Collapsible Cards */}
                <div className="space-y-2.5">
                  {sources.map((src, idx) => {
                    const isCardExpanded = Boolean(expandedSources[src.id]);
                    const similarityPct =
                      src.score !== undefined ? Math.round(src.score * 100) : undefined;

                    return (
                      <div
                        key={src.id}
                        className={`rounded-xl border transition-all duration-150 overflow-hidden ${
                          isCardExpanded
                            ? "bg-base-200/70 border-primary/30 shadow-sm"
                            : "bg-base-200/30 hover:bg-base-200/50 border-base-300"
                        }`}
                      >
                        {/* Collapsible Card Header */}
                        <div
                          onClick={() => toggleSource(src.id)}
                          className="px-4 py-3 flex items-center justify-between cursor-pointer select-none gap-3"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="text-xs font-bold text-base-content/40 font-mono w-5">
                              #{idx + 1}
                            </span>
                            <span className="font-semibold text-xs sm:text-sm text-base-content line-clamp-1">
                              📄 {src.title}
                            </span>
                            {src.tags && src.tags.length > 0 && (
                              <div className="hidden sm:flex items-center gap-1">
                                {src.tags.slice(0, 2).map((t) => (
                                  <span
                                    key={t}
                                    className="badge badge-ghost badge-xs font-mono text-[10px]"
                                  >
                                    #{t}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-2 flex-shrink-0">
                            {similarityPct !== undefined && (
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`badge badge-sm font-mono text-[10px] font-bold ${getScoreColor(
                                    src.score
                                  )}`}
                                >
                                  {similarityPct}% Match
                                </span>
                              </div>
                            )}
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs btn-circle text-base-content/50"
                              title={isCardExpanded ? "Collapse note" : "Expand note"}
                            >
                              <span className="transform transition-transform text-[11px]">
                                {isCardExpanded ? "▲" : "▼"}
                              </span>
                            </button>
                          </div>
                        </div>

                        {/* Collapsible Card Content */}
                        {isCardExpanded && (
                          <div className="px-4 pb-3 pt-1 border-t border-base-300/60 space-y-2.5 text-xs animate-in fade-in duration-150">
                            <p className="text-base-content/75 leading-relaxed bg-base-100/70 p-3 rounded-lg border border-base-300/50">
                              {src.snippet || <span className="italic text-base-content/40">No preview text available</span>}
                            </p>

                            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                              <span className="text-[10px] font-mono text-base-content/50">
                                Document ID: <code>{src.id}</code>
                              </span>

                              {onOpenNote && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onOpenNote(src.id);
                                  }}
                                  className="btn btn-outline btn-primary btn-xs font-semibold gap-1"
                                >
                                  <span>Open in TipTap Editor</span>
                                  <span>→</span>
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Empty State when no search conducted yet */}
      {!answer && !loading && notes.length > 0 && (
        <div className="card bg-base-200/20 border border-dashed border-base-300 p-8 text-center space-y-2">
          <div className="text-3xl">💡</div>
          <h4 className="font-bold text-sm">Ask your personal Second Brain anything</h4>
          <p className="text-xs text-base-content/60 max-w-md mx-auto">
            Your notes are vector indexed with 768 dimensions. Ask questions across your ideas, meeting notes, project plans, and captured links to get grounded answers with direct citations.
          </p>
        </div>
      )}
    </div>
  );
}
