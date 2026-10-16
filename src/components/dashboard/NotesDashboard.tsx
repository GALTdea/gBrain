"use client";

import React, { useState, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { useAuth } from "@/context/AuthContext";
import { Note } from "@/types/note";
import { subscribeToUserNotes, deleteNote } from "@/lib/notes/notes-service";
import VoiceRecorder from "@/components/voice/VoiceRecorder";

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
  const [isCreatingNew, setIsCreatingNew] = useState<boolean>(false);

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

  const handleStartNewNote = () => {
    setActiveEditingNote(null);
    setIsCreatingNew(true);
  };

  const handleOpenNote = (note: Note) => {
    setActiveEditingNote(note);
    setIsCreatingNew(false);
  };

  const handleCloseEditor = () => {
    setActiveEditingNote(null);
    setIsCreatingNew(false);
  };

  const formatNoteDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString([], { month: "short", day: "numeric" });
  };

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6">
      {/* Dashboard Top Header Navigation */}
      <header className="navbar bg-base-200/60 backdrop-blur rounded-2xl border border-base-300 shadow-sm px-4">
        <div className="flex-1 items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold text-xl shadow-inner">
            🧠
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-lg tracking-tight">Second Brain</span>
              <span className="badge badge-primary badge-sm font-semibold">Phase 5</span>
            </div>
            <div className="text-[11px] text-base-content/60 font-mono flex items-center gap-1.5">
              <span>User: <strong>{user?.displayName || user?.email?.split("@")[0]}</strong></span>
              <span>•</span>
              <span className="text-secondary">Subcollection: users/{user?.uid.slice(0, 8)}.../notes</span>
            </div>
          </div>
        </div>

        <div className="flex-none items-center gap-2">
          {!isCreatingNew && !activeEditingNote && (
            <>
              {/* Voice Recorder Action Button */}
              <VoiceRecorder
                onNoteCreated={(note) => {
                  handleOpenNote(note);
                }}
              />

              <button
                onClick={handleStartNewNote}
                className="btn btn-primary btn-sm font-semibold shadow-md gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Note
              </button>
            </>
          )}

          <button
            onClick={() => signOut()}
            className="btn btn-ghost btn-sm hover:btn-error text-xs"
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
            userId={user?.uid || ""}
            onClose={handleCloseEditor}
            onSaveSuccess={(saved) => {
              // Update local state if editing
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
          {/* Navigation Tab Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-base-300 pb-3">
            <div className="tabs tabs-boxed bg-base-200/80 p-1 rounded-xl flex max-w-sm">
              <button
                role="tab"
                onClick={() => setActiveTab("notes")}
                className={`tab flex-1 gap-2 font-medium transition-all ${
                  activeTab === "notes" ? "tab-active font-bold shadow-sm" : ""
                }`}
              >
                <span>📝</span>
                <span>My Notes</span>
                <span className="badge badge-sm badge-ghost">{notes.length}</span>
              </button>
              <button
                role="tab"
                onClick={() => setActiveTab("search")}
                className={`tab flex-1 gap-2 font-medium transition-all ${
                  activeTab === "search" ? "tab-active font-bold shadow-sm" : ""
                }`}
              >
                <span>🧠</span>
                <span>Search Your Brain</span>
                <span className="badge badge-sm badge-primary">AI</span>
              </button>
            </div>

            {activeTab === "notes" ? (
              <button
                type="button"
                onClick={() => setActiveTab("search")}
                className="btn btn-ghost btn-xs text-primary gap-1.5 self-start sm:self-auto font-medium hover:bg-primary/10"
              >
                <span>✨ Ask AI about your notes</span>
                <span>→</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setActiveTab("notes")}
                className="btn btn-ghost btn-xs gap-1.5 self-start sm:self-auto font-medium"
              >
                <span>← Back to Notes</span>
              </button>
            )}
          </div>

          {/* Search Your Brain Tab */}
          {activeTab === "search" && (
            <div className="animate-in fade-in duration-200">
              <ConversationalSearch
                userId={user?.uid || ""}
                notes={notes}
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
              {/* Search, Filter & Stats Bar */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <svg
                className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-base-content/40"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search notes or #tags..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input input-bordered input-sm w-full pl-10 bg-base-100 text-sm focus:input-primary"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-base-content/40 hover:text-base-content"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 text-xs text-base-content/60 justify-end">
              <span>{notes.length} {notes.length === 1 ? "note" : "notes"} in subcollection</span>
            </div>
          </div>

          {/* Tag Filter Pills */}
          {allTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-base-content/50 font-semibold mr-1">Filter:</span>
              <button
                onClick={() => setSelectedTag(null)}
                className={`badge badge-sm py-2 cursor-pointer transition-all ${
                  selectedTag === null ? "badge-primary" : "badge-outline hover:badge-ghost"
                }`}
              >
                All
              </button>
              {allTags.map((t) => (
                <button
                  key={t}
                  onClick={() => setSelectedTag(selectedTag === t ? null : t)}
                  className={`badge badge-sm py-2 font-mono cursor-pointer transition-all ${
                    selectedTag === t ? "badge-primary" : "badge-outline hover:badge-ghost"
                  }`}
                >
                  #{t}
                </button>
              ))}
            </div>
          )}

          {/* Loading State */}
          {loading && (
            <div className="flex flex-col items-center justify-center min-h-[300px] gap-3">
              <span className="loading loading-spinner loading-lg text-primary"></span>
              <span className="text-xs text-base-content/50 font-mono">Syncing notes from Firestore...</span>
            </div>
          )}

          {/* Empty State */}
          {!loading && notes.length === 0 && (
            <div className="card bg-base-200/40 border border-base-300 text-center p-12 shadow-sm">
              <div className="max-w-md mx-auto space-y-4">
                <div className="w-16 h-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center text-3xl mx-auto ring-1 ring-primary/20">
                  🧠
                </div>
                <h3 className="text-xl font-bold">Your Second Brain is Ready</h3>
                <p className="text-sm text-base-content/60">
                  Capture thoughts with the TipTap editor or record a voice memo. Gemini 1.5 Flash automatically transcribes, summarizes, and generates vector embeddings.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                  <button
                    onClick={handleStartNewNote}
                    className="btn btn-primary btn-sm font-semibold shadow-md gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Create Note
                  </button>
                  <VoiceRecorder onNoteCreated={(note) => handleOpenNote(note)} />
                </div>
              </div>
            </div>
          )}

          {/* Filter Empty State */}
          {!loading && notes.length > 0 && filteredNotes.length === 0 && (
            <div className="text-center py-12 text-base-content/60 text-sm">
              No notes matched your search query &ldquo;{searchQuery || selectedTag}&rdquo;.
            </div>
          )}

          {/* Notes Grid (Masonry responsive layout) */}
          {!loading && filteredNotes.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredNotes.map((note) => (
                <div
                  key={note.id}
                  onClick={() => handleOpenNote(note)}
                  className="card bg-base-200/50 hover:bg-base-200/90 border border-base-300 hover:border-primary/40 shadow-sm hover:shadow-md cursor-pointer transition-all duration-150 group flex flex-col justify-between"
                >
                  <div className="card-body p-5 space-y-2">
                    {/* Note Title & Delete Action */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        {note.audioUrl && (
                          <span
                            className="badge badge-secondary badge-xs shrink-0 font-medium"
                            title="Voice Memo"
                          >
                            🎙️ Voice
                          </span>
                        )}
                        <h4 className="font-bold text-base truncate group-hover:text-primary transition-colors">
                          {note.title}
                        </h4>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => handleDelete(e, note.id)}
                        className="btn btn-ghost btn-xs btn-circle opacity-0 group-hover:opacity-100 hover:btn-error transition-opacity text-base-content/60 shrink-0"
                        title="Delete Note"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>

                    {/* Audio Player if recorded */}
                    {note.audioUrl && (
                      <div
                        className="pt-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <audio
                          controls
                          src={note.audioUrl}
                          className="w-full h-8 rounded opacity-85 hover:opacity-100"
                        />
                      </div>
                    )}

                    {/* Plain Text Snippet (Derived from TipTap) */}
                    <p className="text-xs text-base-content/70 line-clamp-3 leading-relaxed">
                      {note.plain_text || <span className="italic text-base-content/40">Empty note...</span>}
                    </p>

                    {/* Tags */}
                    {note.tags && note.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {note.tags.map((tag) => (
                          <span
                            key={tag}
                            className="badge badge-ghost badge-xs font-mono text-[10px] text-base-content/60"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Footer metadata */}
                  <div className="px-5 py-2.5 border-t border-base-300/60 bg-base-300/20 text-[11px] text-base-content/50 font-mono flex items-center justify-between">
                    <span>{formatNoteDate(note.updatedAt)}</span>
                    <span className="text-[10px] uppercase text-primary/80 font-bold group-hover:underline">
                      Edit →
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

