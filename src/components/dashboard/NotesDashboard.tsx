"use client";

import React, { useState, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { useAuth } from "@/context/AuthContext";
import { Note } from "@/types/note";
import { subscribeToUserNotes, deleteNote, saveNote, saveLocalDemoNotes } from "@/lib/notes/notes-service";
import VoiceRecorder from "@/components/voice/VoiceRecorder";

/**
 * Extracts AI summary and raw transcript from TipTap JSON or plain_text for voice notes.
 */
function parseVoiceNote(note: Note): { summary: string; transcript: string } {
  let summary = "";
  let transcript = "";

  // 1. Try parsing from TipTap JSON structure
  const contentObj = note.content as
    | { content?: Array<{ type?: string; text?: string; content?: unknown[] }> }
    | undefined;

  if (contentObj && Array.isArray(contentObj.content)) {
    const blocks = contentObj.content;
    let section: "none" | "summary" | "transcript" = "none";
    const summaryList: string[] = [];
    const transcriptList: string[] = [];

    const getBlockText = (b: unknown): string => {
      if (!b || typeof b !== "object") return "";
      const node = b as { text?: string; content?: unknown[] };
      if (node.text) return node.text;
      if (Array.isArray(node.content)) return node.content.map(getBlockText).join("");
      return "";
    };

    for (const b of blocks) {
      const text = getBlockText(b).trim();
      if (b.type === "heading" && /summary/i.test(text)) {
        section = "summary";
        continue;
      }
      if (b.type === "heading" && /transcript/i.test(text)) {
        section = "transcript";
        continue;
      }
      if (text.startsWith("🎵 Audio Recording:")) {
        continue;
      }

      if (section === "summary" && text) {
        summaryList.push(text);
      } else if (section === "transcript" && text) {
        transcriptList.push(text);
      }
    }

    if (summaryList.length > 0) summary = summaryList.join("\n\n");
    if (transcriptList.length > 0) transcript = transcriptList.join("\n\n");
  }

  // 2. Fallback to plain_text regex parsing
  if (!summary && note.plain_text) {
    const sumMatch = note.plain_text.match(/Summary:\s*([\s\S]*?)(?:Transcript:|$)/i);
    if (sumMatch && sumMatch[1]?.trim()) {
      summary = sumMatch[1].trim();
    }
    const transMatch = note.plain_text.match(/Transcript:\s*([\s\S]*)/i);
    if (transMatch && transMatch[1]?.trim()) {
      transcript = transMatch[1].trim();
    }
  }

  // 3. Fallback if no explicit summary section found
  if (!summary && note.plain_text) {
    summary = note.plain_text;
  }

  return { summary, transcript };
}

const TipTapEditor = dynamic(() => import("@/components/editor/TipTapEditor"), {
  loading: () => (
    <div className="flex items-center justify-center py-16">
      <span className="loading loading-spinner loading-md text-primary"></span>
    </div>
  ),
});

const ConversationalSearch = dynamic(
  () => import("@/components/search/ConversationalSearch"),
  {
    loading: () => (
      <div className="flex items-center justify-center py-16">
        <span className="loading loading-spinner loading-md text-primary"></span>
      </div>
    ),
  }
);

export default function NotesDashboard() {
  const { user, signOut } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<"notes" | "search">("notes");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [activeEditingNote, setActiveEditingNote] = useState<Note | null>(null);
  const [editorInitialText, setEditorInitialText] = useState<string>("");
  const [isCreatingNew, setIsCreatingNew] = useState<boolean>(false);
  const [isSavingQuickNote, setIsSavingQuickNote] = useState<boolean>(false);
  const [isSeedingNotes, setIsSeedingNotes] = useState<boolean>(false);
  const [seedFeedback, setSeedFeedback] = useState<string | null>(null);

  const handleSeedNotes = async () => {
    if (!user?.uid || isSeedingNotes) return;
    setIsSeedingNotes(true);
    setSeedFeedback("Importing 80 Keep notes & generating embeddings...");
    try {
      const res = await fetch("/api/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.uid }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to seed notes");
      }
      if (Array.isArray(data.notes) && data.notes.length > 0) {
        setNotes(data.notes);
        if (user.uid.startsWith("usr_")) {
          saveLocalDemoNotes(user.uid, data.notes);
          window.dispatchEvent(new Event("gbrain-notes-updated"));
        }
      }
      setSeedFeedback(`Imported ${data.notesCount || 80} Keep notes!`);
      setTimeout(() => setSeedFeedback(null), 4000);
    } catch (err: unknown) {
      console.error("Failed to seed notes:", err);
      const msg = err instanceof Error ? err.message : "Failed to import notes";
      setSeedFeedback(`Error: ${msg}`);
      setTimeout(() => setSeedFeedback(null), 5000);
    } finally {
      setIsSeedingNotes(false);
    }
  };

  // Subscribe to notes in users/{userId}/notes
  useEffect(() => {
    if (!user?.uid) return;

    const unsubscribe = subscribeToUserNotes(
      user.uid,
      (fetchedNotes) => {
        setNotes(fetchedNotes);
        setLoading(false);
      },
      (error) => {
        console.error("Dashboard notes error:", error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid]);

  // Aggregate all unique tags across notes for filtering
  const allTags = useMemo(() => {
    const set = new Set<string>();
    notes.forEach((n) => n.tags?.forEach((t) => set.add(t)));
    return Array.from(set);
  }, [notes]);

  // Client-side filtering across title, plain_text, and tags
  const filteredNotes = useMemo(() => {
    let result = notes;
    if (selectedTag) {
      result = result.filter((n) => n.tags?.includes(selectedTag));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.plain_text.toLowerCase().includes(q) ||
          n.tags?.some((t) => t.toLowerCase().includes(q))
      );
    }
    return result;
  }, [notes, searchQuery, selectedTag]);

  const handleDelete = async (e: React.MouseEvent, noteId: string) => {
    e.stopPropagation();
    if (!user?.uid) return;
    if (confirm("Are you sure you want to delete this note?")) {
      try {
        await deleteNote(user.uid, noteId);
      } catch (err) {
        console.error("Delete failed:", err);
      }
    }
  };

  const handleStartNewNote = (initialText?: string | React.MouseEvent) => {
    setActiveEditingNote(null);
    setEditorInitialText(typeof initialText === "string" ? initialText : "");
    setIsCreatingNew(true);
  };

  const handleOpenNote = (note: Note) => {
    setActiveEditingNote(note);
    setEditorInitialText("");
    setIsCreatingNew(false);
  };

  const handleCloseEditor = () => {
    setActiveEditingNote(null);
    setEditorInitialText("");
    setIsCreatingNew(false);
  };

  const saveQuickNote = async (rawText: string) => {
    const text = rawText.trim();
    if (!text || !user?.uid) return;

    setIsSavingQuickNote(true);

    const newId = `note_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const firstLine = text.split("\n")[0].trim();
    const title = firstLine.length > 60 ? `${firstLine.substring(0, 60)}...` : firstLine;

    const newNoteData: Note = {
      id: newId,
      title,
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text }],
          },
        ],
      },
      plain_text: text,
      tags: [],
      userId: user.uid,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    try {
      setSearchQuery("");
      await saveNote(user.uid, newNoteData);
    } catch (err) {
      console.error("Failed to quick-save note from Omnibar:", err);
    } finally {
      setIsSavingQuickNote(false);
    }
  };

  const handleOmnibarKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      if (activeTab === "search") {
        return;
      }
      e.preventDefault();
      await saveQuickNote(searchQuery);
    }
  };

  const formatNoteDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString([], { month: "short", day: "numeric" });
  };

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6">
      {/* Dashboard Top Header Navigation */}
      <header className="navbar bg-white/90 backdrop-blur rounded-2xl border border-[#D8DEE9] shadow-sm px-5 py-3">
        <div className="flex-1 items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#E5E9F0] text-[#5E81AC] flex items-center justify-center font-bold text-xl shadow-inner">
            🧠
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-lg tracking-tight text-[#2E3440]">Second Brain</span>
            </div>
            <div className="text-xs text-[#64748B]">
              {user?.displayName || user?.email}
            </div>
          </div>
        </div>

        <div className="flex-none items-center gap-2">
          {seedFeedback && (
            <span className="badge badge-sm bg-blue-50 text-[#5E81AC] ring-1 ring-[#5E81AC]/20 border-none font-medium animate-pulse text-[11px] py-2 px-2.5">
              {seedFeedback}
            </span>
          )}

          {/* Create New Note button */}
          <button
            type="button"
            onClick={() => handleStartNewNote()}
            className="btn btn-sm bg-[#5E81AC] hover:bg-[#81A1C1] text-white border-none text-xs font-semibold gap-1.5 shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>New Note</span>
          </button>

          <button
            type="button"
            onClick={handleSeedNotes}
            disabled={isSeedingNotes}
            className="btn btn-sm btn-outline border-[#D8DEE9] text-[#2E3440] hover:bg-[#E5E9F0] hover:border-[#CBD5E1] text-xs font-semibold gap-1.5"
            title="Import 80 notes from data/lords_favor_restoration_notes.md and compute embeddings"
          >
            {isSeedingNotes ? (
              <>
                <span className="loading loading-spinner loading-xs text-[#5E81AC]"></span>
                <span>Seeding 80 Notes...</span>
              </>
            ) : (
              <>
                <span>📥</span>
                <span>{notes.length >= 80 ? "Re-seed 80 Keep Notes" : "Import 80 Keep Notes"}</span>
              </>
            )}
          </button>

          <button
            onClick={() => signOut()}
            className="btn btn-ghost btn-sm text-xs text-[#64748B] hover:bg-rose-50 hover:text-rose-700"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Editor View (when creating or editing a note) */}
      {(isCreatingNew || activeEditingNote) && (
        <section className="animate-in fade-in duration-200">
          <TipTapEditor
            initialNote={activeEditingNote}
            initialText={editorInitialText}
            userId={user?.uid || ""}
            onClose={handleCloseEditor}
            onSaveSuccess={(saved) => {
              if (activeEditingNote?.id === saved.id) {
                setActiveEditingNote(saved);
              }
            }}
          />
        </section>
      )}

      {/* Notes Grid & Search View (when not editing) */}
      {!isCreatingNew && !activeEditingNote && (
        <section className="space-y-6">
          {/* Central Unified Omnibar */}
          <div className="w-full max-w-2xl mx-auto">
            <div className="relative flex items-center bg-white rounded-2xl border border-[#D8DEE9] focus-within:border-[#5E81AC] shadow-sm hover:shadow focus-within:shadow-md transition-all px-4 py-2.5 gap-2.5">
              {/* Search or saving indicator */}
              {isSavingQuickNote ? (
                <span className="loading loading-spinner loading-sm text-[#5E81AC] shrink-0"></span>
              ) : (
                <svg
                  className="w-5 h-5 text-[#94A3B8] shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              )}

              {/* Omnibar Input */}
              <input
                type="text"
                placeholder={
                  activeTab === "search"
                    ? "Ask your brain anything..."
                    : "Search notes, or type a thought and press Enter to save..."
                }
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleOmnibarKeyDown}
                className="bg-transparent border-none outline-none flex-1 text-sm text-[#2E3440] placeholder-[#94A3B8] focus:ring-0 min-w-0"
              />

              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="btn btn-ghost btn-xs btn-circle text-[#94A3B8] hover:text-[#2E3440] shrink-0"
                  title="Clear input"
                >
                  ✕
                </button>
              )}

              <div className="flex items-center gap-1 shrink-0 pl-1.5 border-l border-[#D8DEE9]">
                {/* Full note editor launcher */}
                <button
                  type="button"
                  onClick={() => {
                    const text = searchQuery;
                    setSearchQuery("");
                    handleStartNewNote(text);
                  }}
                  className="btn btn-circle btn-sm btn-ghost text-[#4C566A] hover:text-[#5E81AC] hover:bg-[#E5E9F0]/60 transition-colors"
                  title="Open in full note editor"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                    />
                  </svg>
                </button>

                {/* Microphone button (VoiceRecorder) */}
                <VoiceRecorder
                  compact
                  onNoteCreated={(note) => {
                    handleOpenNote(note);
                  }}
                />

                {/* AI Conversational Search trigger */}
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab(activeTab === "search" ? "notes" : "search");
                  }}
                  className={`btn btn-circle btn-sm btn-ghost transition-colors ${
                    activeTab === "search"
                      ? "text-[#5E81AC] bg-blue-50 ring-1 ring-[#5E81AC]/20"
                      : "text-[#4C566A] hover:text-[#5E81AC] hover:bg-[#E5E9F0]/60"
                  }`}
                  title={activeTab === "search" ? "Switch back to Notes" : "Search Your Brain with AI"}
                >
                  <span className="text-sm">✨</span>
                </button>
              </div>
            </div>

            {/* Helper hint when user types in notes mode */}
            {activeTab === "notes" && searchQuery.trim().length > 0 && (
              <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 text-[11px] text-[#64748B] px-3 pt-2 font-sans">
                <span className="truncate max-w-[220px] sm:max-w-xs text-[#2E3440]">
                  Filtering notes for &ldquo;{searchQuery.trim().length > 30 ? searchQuery.trim().substring(0, 30) + "…" : searchQuery.trim()}&rdquo;
                </span>
                <div className="flex items-center gap-2 shrink-0 whitespace-nowrap ml-auto">
                  <button
                    type="button"
                    onClick={() => {
                      const text = searchQuery;
                      setSearchQuery("");
                      handleStartNewNote(text);
                    }}
                    className="btn btn-xs bg-[#5E81AC] hover:bg-[#81A1C1] text-white border-none font-medium gap-1 shadow-sm"
                  >
                    <span>📝 Open in Full Editor</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => saveQuickNote(searchQuery)}
                    disabled={isSavingQuickNote}
                    className="text-[#5E81AC] hover:text-[#81A1C1] hover:underline font-medium flex items-center gap-1"
                  >
                    Press <kbd className="kbd kbd-xs bg-[#E5E9F0] text-[#2E3440] border-[#D8DEE9]">Enter ↵</kbd> to quick-save
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Navigation Tab Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#D8DEE9] pb-3">
            <div className="tabs tabs-boxed bg-[#E5E9F0]/70 border border-[#D8DEE9] p-1 rounded-xl flex max-w-sm">
              <button
                role="tab"
                onClick={() => setActiveTab("notes")}
                className={`tab flex-1 gap-2 font-medium transition-all ${
                  activeTab === "notes" ? "tab-active bg-white text-[#2E3440] font-bold shadow-sm" : "text-[#4C566A] hover:text-[#2E3440]"
                }`}
              >
                <span>📝</span>
                <span>My Notes</span>
                <span className="badge badge-sm bg-[#D8DEE9] text-[#2E3440] border-none">{notes.length}</span>
              </button>
              <button
                role="tab"
                onClick={() => setActiveTab("search")}
                className={`tab flex-1 gap-2 font-medium transition-all ${
                  activeTab === "search" ? "tab-active bg-white text-[#2E3440] font-bold shadow-sm" : "text-[#4C566A] hover:text-[#2E3440]"
                }`}
              >
                <span>🧠</span>
                <span>Search Your Brain</span>
                <span className="badge badge-sm bg-[#5E81AC] text-white border-none">AI</span>
              </button>
            </div>

            <div className="flex items-center gap-2 self-start sm:self-auto">
              <button
                type="button"
                onClick={() => handleStartNewNote()}
                className="btn bg-[#5E81AC] hover:bg-[#81A1C1] text-white border-none btn-sm font-semibold gap-1.5 shadow-sm"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span>New Note</span>
              </button>

              {activeTab === "notes" ? (
                <button
                  type="button"
                  onClick={() => setActiveTab("search")}
                  className="btn btn-ghost btn-sm text-[#5E81AC] gap-1.5 font-medium hover:bg-blue-50"
                >
                  <span>✨ Ask AI about your notes</span>
                  <span>→</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setActiveTab("notes")}
                  className="btn btn-ghost btn-sm gap-1.5 font-medium text-[#4C566A] hover:text-[#2E3440] hover:bg-[#E5E9F0]"
                >
                  <span>← Back to Notes</span>
                </button>
              )}
            </div>
          </div>

          {/* Search Your Brain Tab */}
          {activeTab === "search" && (
            <div className="animate-in fade-in duration-200">
              <ConversationalSearch
                key={`search-${searchQuery || "default"}`}
                userId={user?.uid || ""}
                notes={notes}
                initialQuery={searchQuery}
                onOpenNote={(id) => {
                  const matched = notes.find((n) => n.id === id);
                  if (matched) handleOpenNote(matched);
                }}
              />
            </div>
          )}

          {/* My Notes Tab */}
          {activeTab === "notes" && (
            <div className="space-y-6 animate-in fade-in duration-200">
              {/* Filter Pills & Stats Bar */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                {/* Tag Filter Pills */}
                {allTags.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="text-[#64748B] font-semibold mr-1">Filter:</span>
                    <button
                      onClick={() => setSelectedTag(null)}
                      className={`badge badge-sm py-2 px-2.5 rounded-full cursor-pointer transition-all border-none ${
                        selectedTag === null
                          ? "bg-[#5E81AC] text-white shadow-sm font-semibold"
                          : "bg-[#E5E9F0] text-[#2E3440] hover:bg-[#D8DEE9]"
                      }`}
                    >
                      All
                    </button>
                    {allTags.map((t) => (
                      <button
                        key={t}
                        onClick={() => setSelectedTag(selectedTag === t ? null : t)}
                        className={`badge badge-sm py-2 px-2.5 rounded-full font-mono cursor-pointer transition-all border-none ${
                          selectedTag === t
                            ? "bg-[#5E81AC] text-white shadow-sm font-semibold"
                            : "bg-[#E5E9F0] text-[#2E3440] hover:bg-[#D8DEE9]"
                        }`}
                      >
                        #{t}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div></div>
                )}

                <div className="text-xs text-[#64748B] self-end sm:self-auto font-mono">
                  {notes.length} {notes.length === 1 ? "note" : "notes"}
                </div>
              </div>

              {/* Loading State */}
              {loading && (
                <div className="flex flex-col items-center justify-center min-h-[300px] gap-3">
                  <span className="loading loading-spinner loading-lg text-[#5E81AC]"></span>
                  <span className="text-xs text-[#64748B]">Loading notes...</span>
                </div>
              )}

              {/* Empty State */}
              {!loading && notes.length === 0 && (
                <div className="card bg-white border border-[#D8DEE9] text-center p-12 shadow-sm rounded-2xl">
                  <div className="max-w-md mx-auto space-y-4">
                    <div className="w-16 h-16 rounded-2xl bg-[#E5E9F0] text-[#5E81AC] flex items-center justify-center text-3xl mx-auto ring-1 ring-[#D8DEE9]">
                      🧠
                    </div>
                    <h3 className="text-xl font-bold text-[#2E3440]">Your Second Brain is Ready</h3>
                    <p className="text-sm text-[#64748B]">
                      Type your first note in the Omnibar above, or use the microphone to capture a voice memo.
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                      <button
                        onClick={handleStartNewNote}
                        className="btn bg-[#5E81AC] hover:bg-[#81A1C1] text-white border-none btn-sm font-semibold shadow gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Open Editor
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Filter Empty State */}
              {!loading && notes.length > 0 && filteredNotes.length === 0 && (
                <div className="text-center py-12 text-[#64748B] text-sm">
                  No notes matched your search query &ldquo;{searchQuery || selectedTag}&rdquo;.
                </div>
              )}

              {/* Notes Grid (Masonry responsive layout) */}
              {!loading && filteredNotes.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredNotes.map((note) => {
                    const isVoice = Boolean(
                      note.audioUrl || note.audioStorageUri || note.tags?.includes("voice-memo")
                    );
                    const { summary, transcript } = isVoice
                      ? parseVoiceNote(note)
                      : { summary: "", transcript: "" };

                    return (
                      <div
                        key={note.id}
                        onClick={() => handleOpenNote(note)}
                        className="bg-white rounded-xl border border-[#D8DEE9] shadow-sm hover:shadow-md cursor-pointer transition-all duration-150 group flex flex-col justify-between overflow-hidden"
                      >
                        <div className="p-5 space-y-3">
                          {/* Note Title & Delete Action */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-1.5 flex-1 min-w-0">
                              {isVoice && (
                                <span
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-pink-50 text-pink-700 ring-1 ring-pink-700/10 shrink-0"
                                  title="Voice Note"
                                >
                                  🎙️ Voice
                                </span>
                              )}
                              <h4 className="font-bold text-base text-[#2E3440] truncate group-hover:text-[#5E81AC] transition-colors">
                                {note.title}
                              </h4>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => handleDelete(e, note.id)}
                              className="btn btn-ghost btn-xs btn-circle opacity-0 group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-600 transition-all text-[#94A3B8] shrink-0"
                              title="Delete Note"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>

                          {/* HTML5 Audio Player if note has audioUrl */}
                          {note.audioUrl && (
                            <div
                              className="pt-0.5 w-full"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <audio
                                controls
                                preload="metadata"
                                src={note.audioUrl}
                                className="w-full h-8 rounded-lg opacity-85 hover:opacity-100 transition-opacity"
                              />
                            </div>
                          )}

                          {/* Note Content: AI Summary & Collapsible Transcript for Voice, Plain text snippet for regular notes */}
                          {isVoice ? (
                            <div className="space-y-2.5">
                              {summary && (
                                <div className="space-y-1">
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider bg-blue-50 text-[#5E81AC] ring-1 ring-[#5E81AC]/20">
                                    ✨ AI Summary
                                  </span>
                                  <p className="text-xs text-[#2E3440] leading-relaxed line-clamp-3">
                                    {summary}
                                  </p>
                                </div>
                              )}

                              {transcript && (
                                <details
                                  className="group/details text-xs bg-[#F8FAFC] hover:bg-[#F1F5F9] rounded-xl p-2.5 transition-colors border border-[#D8DEE9]"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <summary className="cursor-pointer font-medium text-[#4C566A] hover:text-[#2E3440] select-none flex items-center justify-between list-none">
                                    <span className="flex items-center gap-1.5 text-xs">
                                      <svg className="w-3.5 h-3.5 text-[#88C0D0]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                                      </svg>
                                      Raw Transcript
                                    </span>
                                    <span className="text-[10px] text-[#64748B] font-mono group-open/details:rotate-180 transition-transform">
                                      ▼
                                    </span>
                                  </summary>
                                  <div className="mt-2 text-xs text-[#4C566A] italic whitespace-pre-wrap max-h-36 overflow-y-auto pr-1 leading-relaxed border-t border-[#D8DEE9] pt-2">
                                    {transcript}
                                  </div>
                                </details>
                              )}
                            </div>
                          ) : (
                            <p className="text-xs text-[#4C566A] line-clamp-3 leading-relaxed">
                              {note.plain_text || <span className="italic text-[#94A3B8]">Empty note...</span>}
                            </p>
                          )}

                          {/* Tags */}
                          {note.tags && note.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 pt-1">
                              {note.tags.map((tag) => (
                                <span
                                  key={tag}
                                  className="bg-[#E5E9F0] text-[#2E3440] hover:bg-[#D8DEE9] rounded-md px-2 py-0.5 text-[10px] font-mono transition-colors"
                                >
                                  #{tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Footer metadata */}
                        <div className="px-5 py-2.5 border-t border-[#D8DEE9] bg-[#F8FAFC] text-[11px] font-mono flex items-center justify-between">
                          <span className="text-[#64748B]">{formatNoteDate(note.updatedAt)}</span>
                          <span className="text-[10px] uppercase text-[#5E81AC] hover:text-[#81A1C1] font-medium group-hover:underline">
                            Edit →
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* Floating Action Button (FAB) for quick note creation anywhere on screen */}
      {!isCreatingNew && !activeEditingNote && (
        <button
          type="button"
          onClick={() => handleStartNewNote()}
          className="fixed bottom-6 right-6 z-40 btn btn-circle bg-[#5E81AC] hover:bg-[#81A1C1] border-none btn-lg shadow-xl hover:scale-105 active:scale-95 transition-all text-white flex items-center justify-center"
          title="Create New Note (+)"
          aria-label="Create New Note"
        >
          <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      )}
    </div>
  );
}

