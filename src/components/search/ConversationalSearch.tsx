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
  initialQuery?: string;
}

export default function ConversationalSearch({
  userId,
  notes,
  onOpenNote,
  initialQuery = "",
}: ConversationalSearchProps) {
  const [query, setQuery] = useState(initialQuery);
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
    if (score === undefined) return "bg-[#E5E9F0] text-[#2E3440]";
    if (score >= 0.8) return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-700/10";
    if (score >= 0.6) return "bg-blue-50 text-[#5E81AC] ring-1 ring-[#5E81AC]/20";
    return "bg-amber-50 text-amber-700 ring-1 ring-amber-700/10";
  };

  return (
    <div className="space-y-6">
      {/* Search Header Banner */}
      <div className="bg-white border border-[#D8DEE9] shadow-sm rounded-2xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-[#E5E9F0] text-[#5E81AC] flex items-center justify-center text-2xl shadow-inner">
              ✨
            </div>
            <div>
              <h2 className="text-xl font-extrabold tracking-tight text-[#2E3440] flex items-center gap-2">
                Search Your Brain
                <span className="badge bg-blue-50 text-[#5E81AC] ring-1 ring-[#5E81AC]/20 border-none badge-sm font-semibold">
                  Gemini 1.5 Flash
                </span>
              </h2>
              <p className="text-xs text-[#64748B]">
                Natural language question answering grounded in your personal notes via 768-dim vector embeddings
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono text-[#64748B] self-start sm:self-auto bg-[#F8FAFC] px-3 py-1.5 rounded-lg border border-[#D8DEE9]">
            <span>Model: <strong className="text-[#2E3440]">text-embedding-004</strong></span>
            <span>•</span>
            <span className="text-[#5E81AC]">k=15 nearest</span>
          </div>
        </div>

        {/* Natural Language Search Input Form */}
        <form onSubmit={handleSearch} className="space-y-3">
          <div className="relative">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#94A3B8] text-lg pointer-events-none">
              🔍
            </div>
            <input
              type="text"
              placeholder="Ask a question about your notes... (e.g., 'What are our key architecture decisions?')"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={loading}
              className="w-full pl-12 pr-32 py-3 bg-white border border-[#D8DEE9] text-sm text-[#2E3440] placeholder-[#94A3B8] focus:border-[#5E81AC] outline-none shadow-sm rounded-xl transition-all"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
              {query && !loading && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="btn btn-ghost btn-xs btn-circle text-[#94A3B8] hover:text-[#2E3440]"
                  title="Clear query"
                >
                  ✕
                </button>
              )}
              <button
                type="submit"
                disabled={loading || !query.trim()}
                className="btn btn-sm bg-[#5E81AC] hover:bg-[#81A1C1] text-white border-none font-semibold gap-1.5 shadow rounded-lg"
              >
                {loading ? (
                  <span className="loading loading-spinner loading-xs text-white"></span>
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
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#64748B] pt-1">
              <span className="text-[11px] font-semibold text-[#64748B]">Suggestions:</span>
              <button
                type="button"
                onClick={() => handleSuggestedPrompt("What are the main architecture and design decisions?")}
                className="bg-[#E5E9F0] text-[#2E3440] hover:bg-[#D8DEE9] text-[11px] py-1.5 px-2.5 rounded-full cursor-pointer transition-colors"
              >
                Architecture decisions
              </button>
              <button
                type="button"
                onClick={() => handleSuggestedPrompt("Summarize all notes and key concepts")}
                className="bg-[#E5E9F0] text-[#2E3440] hover:bg-[#D8DEE9] text-[11px] py-1.5 px-2.5 rounded-full cursor-pointer transition-colors"
              >
                Summarize all notes
              </button>
              <button
                type="button"
                onClick={() => handleSuggestedPrompt("What tasks or action items are recorded?")}
                className="bg-[#E5E9F0] text-[#2E3440] hover:bg-[#D8DEE9] text-[11px] py-1.5 px-2.5 rounded-full cursor-pointer transition-colors"
              >
                Action items
              </button>
            </div>
          )}
        </form>

        {/* Error Alert */}
        {error && (
          <div className="alert bg-rose-50 border border-rose-200 text-rose-700 text-xs py-3 rounded-xl flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={() => setError(null)}
              className="btn btn-ghost btn-xs btn-circle text-rose-700"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Loading State Animation */}
      {loading && (
        <div className="bg-white border border-[#D8DEE9] rounded-2xl p-8 text-center space-y-4 shadow-sm animate-in fade-in duration-200">
          <div className="w-14 h-14 rounded-2xl bg-[#E5E9F0] text-[#5E81AC] flex items-center justify-center mx-auto shadow-sm">
            <span className="loading loading-spinner loading-md text-[#5E81AC]"></span>
          </div>
          <div className="space-y-1">
            <h4 className="font-bold text-sm tracking-tight text-[#2E3440]">
              Consulting Second Brain...
            </h4>
            <p className="text-xs font-mono text-[#5E81AC] animate-pulse">
              {loadingStep || "Processing query..."}
            </p>
          </div>
          <div className="w-full max-w-xs mx-auto">
            <progress className="progress w-full text-[#5E81AC]"></progress>
          </div>
        </div>
      )}

      {/* Conversational AI Response Container */}
      {answer && !loading && (
        <div className="bg-white border border-[#D8DEE9] rounded-2xl shadow-md overflow-hidden animate-in fade-in duration-300">
          {/* Answer Card Top Header */}
          <div className="px-6 py-4 bg-[#F8FAFC] border-b border-[#D8DEE9] flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="text-xl">🧠</span>
              <div>
                <div className="font-bold text-sm text-[#5E81AC] flex items-center gap-2">
                  <span>AI Synthesized Answer</span>
                  <span className="badge bg-blue-50 text-[#5E81AC] ring-1 ring-[#5E81AC]/20 border-none badge-xs font-mono">Grounded</span>
                </div>
                <div className="text-[11px] text-[#64748B] font-mono">
                  Query: &ldquo;{currentQuery}&rdquo;
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="badge bg-[#E5E9F0] text-[#2E3440] border-none badge-sm text-[11px] font-mono">
                {usedVectorSearch ? "⚡ Firestore findNearest" : "🔍 Cosine Ranking"}
              </span>
              <button
                type="button"
                onClick={handleCopyAnswer}
                className="btn btn-ghost btn-xs gap-1 border border-[#D8DEE9] text-[#4C566A] hover:bg-[#E5E9F0] hover:text-[#2E3440]"
                title="Copy answer to clipboard"
              >
                {copied ? "✓ Copied" : "📋 Copy"}
              </button>
            </div>
          </div>

          {/* Answer Body */}
          <div className="p-6 space-y-5">
            <div className="text-sm text-[#2E3440] leading-relaxed whitespace-pre-wrap font-sans bg-[#F8FAFC] p-4 rounded-xl border border-[#D8DEE9]">
              {answer}
            </div>

            {/* Collapsible Referenced Source Notes Section */}
            {sources.length > 0 && (
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between border-b border-[#D8DEE9] pb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-[#2E3440]">
                      Referenced Notes ({sources.length})
                    </span>
                    <span className="text-[11px] text-[#64748B]">
                      Grounded citations &amp; semantic matches
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs">
                    <button
                      type="button"
                      onClick={expandAllSources}
                      className="btn btn-ghost btn-xs text-[11px] text-[#64748B] hover:text-[#5E81AC]"
                    >
                      Expand All
                    </button>
                    <span className="text-[#D8DEE9]">•</span>
                    <button
                      type="button"
                      onClick={collapseAllSources}
                      className="btn btn-ghost btn-xs text-[11px] text-[#64748B] hover:text-[#5E81AC]"
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
                            ? "bg-white border-[#5E81AC]/50 shadow-sm"
                            : "bg-white hover:bg-[#F8FAFC] border-[#D8DEE9]"
                        }`}
                      >
                        {/* Collapsible Card Header */}
                        <div
                          onClick={() => toggleSource(src.id)}
                          className="px-4 py-3 flex items-center justify-between cursor-pointer select-none gap-3"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="text-xs font-bold text-[#94A3B8] font-mono w-5">
                              #{idx + 1}
                            </span>
                            <span className="font-semibold text-xs sm:text-sm text-[#2E3440] line-clamp-1">
                              📄 {src.title}
                            </span>
                            {src.tags && src.tags.length > 0 && (
                              <div className="hidden sm:flex items-center gap-1">
                                {src.tags.slice(0, 2).map((t) => (
                                  <span
                                    key={t}
                                    className="bg-[#E5E9F0] text-[#2E3440] px-2 py-0.5 rounded-md font-mono text-[10px]"
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
                                  className={`badge badge-sm font-mono text-[10px] font-bold border-none ${getScoreColor(
                                    src.score
                                  )}`}
                                >
                                  {similarityPct}% Match
                                </span>
                              </div>
                            )}
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs btn-circle text-[#64748B]"
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
                          <div className="px-4 pb-3 pt-1 border-t border-[#D8DEE9] space-y-2.5 text-xs animate-in fade-in duration-150 bg-[#F8FAFC]/50">
                            <p className="text-[#3B4252] leading-relaxed bg-[#F8FAFC] p-3 rounded-lg border border-[#D8DEE9]">
                              {src.snippet || <span className="italic text-[#94A3B8]">No preview text available</span>}
                            </p>

                            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                              <span className="text-[10px] font-mono text-[#64748B]">
                                Document ID: <code className="bg-[#E5E9F0] px-1 py-0.5 rounded">{src.id}</code>
                              </span>

                              {onOpenNote && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onOpenNote(src.id);
                                  }}
                                  className="btn btn-xs bg-white text-[#5E81AC] hover:bg-blue-50 border border-[#5E81AC]/40 font-semibold gap-1"
                                >
                                  <span>Open Note</span>
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
        <div className="bg-white border border-dashed border-[#D8DEE9] rounded-2xl p-8 text-center space-y-2">
          <div className="text-3xl">💡</div>
          <h4 className="font-bold text-sm text-[#2E3440]">Ask your personal Second Brain anything</h4>
          <p className="text-xs text-[#64748B] max-w-md mx-auto">
            Your notes are vector indexed with 768 dimensions. Ask questions across your ideas, meeting notes, project plans, and captured links to get grounded answers with direct citations.
          </p>
        </div>
      )}
    </div>
  );
}
