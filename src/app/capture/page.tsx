"use client";

import React, { Suspense, useEffect, useState, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { saveNote } from "@/lib/notes/notes-service";
import { Note } from "@/types/note";
import LoginForm from "@/components/auth/LoginForm";
import VoiceRecorder from "@/components/voice/VoiceRecorder";
import {
  getSharedMediaPayload,
  deleteSharedMediaPayload,
} from "@/lib/voice/voice-draft-store";

function extractSummary(note: Note): string {
  if (!note.plain_text) return "";
  const summaryMatch = note.plain_text.match(/Summary:\s*\n*([\s\S]*?)(?=\n\nTranscript:|$)/i);
  if (summaryMatch && summaryMatch[1].trim()) {
    return summaryMatch[1].trim();
  }
  return note.plain_text;
}

function CaptureInner() {
  const searchParams = useSearchParams();
  const { user, loading } = useAuth();

  const titleParam = searchParams.get("title") || "";
  const textParam = searchParams.get("text") || "";
  const urlParam = searchParams.get("url") || "";
  const modeParam = searchParams.get("mode") || "";
  const autostartParam = searchParams.get("autostart") === "1";
  const shareIdParam = searchParams.get("shareId") || "";
  const audioSharedParam = searchParams.get("audioShared") === "1";

  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState<Note | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Appending voice thought state for shared link confirmation view
  const [isAppendingVoice, setIsAppendingVoice] = useState(false);

  // Toggle for voice mode from manual capture screen
  const [isVoiceCaptureMode, setIsVoiceCaptureMode] = useState(modeParam === "voice");

  // Shared audio file processing from Service Worker
  const [processingSharedAudio, setProcessingSharedAudio] = useState(false);
  const [sharedAudioStatus, setSharedAudioStatus] = useState<string | null>(null);

  // Manual fallback inputs (Rule 4 fallback)
  const [manualTitle, setManualTitle] = useState(titleParam);
  const [manualText, setManualText] = useState(
    textParam ? (urlParam ? `${textParam}\n\n${urlParam}` : textParam) : urlParam
  );

  const hasAutoSavedRef = useRef(false);
  const hasProcessedSharedAudioRef = useRef(false);

  const executeSave = useCallback(
    async (title: string, text: string, url: string) => {
      if (!user?.uid) return;

      setSaving(true);
      setError(null);

      try {
        // Determine clean title
        let derivedTitle = title.trim();
        if (!derivedTitle && url.trim()) {
          try {
            derivedTitle = `Link: ${new URL(url).hostname}`;
          } catch {
            derivedTitle = "Shared Link";
          }
        }
        if (!derivedTitle && text.trim()) {
          derivedTitle = text.split("\n")[0].slice(0, 50).trim();
        }
        if (!derivedTitle) {
          derivedTitle = "Quick Capture";
        }

        // Combine text and URL
        let combinedText = text.trim();
        if (url.trim()) {
          combinedText = combinedText ? `${combinedText}\n\n${url.trim()}` : url.trim();
        }

        // Format as TipTap document JSON
        const paragraphs = combinedText.split("\n\n").filter(Boolean);
        const tipTapContent = {
          type: "doc",
          content: paragraphs.length > 0
            ? paragraphs.map((p) => ({
                type: "paragraph",
                content: [{ type: "text", text: p }],
              }))
            : [{ type: "paragraph", content: [{ type: "text", text: combinedText || "" }] }],
        };

        const noteId = `capture_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const saved = await saveNote(user.uid, {
          id: noteId,
          title: derivedTitle,
          content: tipTapContent,
          plain_text: combinedText,
          tags: ["capture", "share-target"],
        });

        setSavedNote(saved);
      } catch (err: unknown) {
        console.error("Capture save failed:", err);
        const message = err instanceof Error ? err.message : "Failed to save captured content.";
        setError(message);
      } finally {
        setSaving(false);
      }
    },
    [user]
  );

  // Process shared audio file from Service Worker (e.g. from Pixel Recorder)
  useEffect(() => {
    if (!user?.uid || hasProcessedSharedAudioRef.current) return;
    if (!shareIdParam || !audioSharedParam) return;

    hasProcessedSharedAudioRef.current = true;

    async function processSharedAudio() {
      try {
        setProcessingSharedAudio(true);
        setSharedAudioStatus("Retrieving shared audio from Pixel Recorder...");

        const shared = await getSharedMediaPayload(shareIdParam);
        if (!shared || !shared.audioBlob) {
          throw new Error("Shared audio recording could not be retrieved from cache.");
        }

        setSharedAudioStatus("Converting audio for Gemini multimodal analysis...");
        const base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(shared.audioBlob!);
        });

        if (!user?.uid) {
          throw new Error("User session required to process shared audio.");
        }

        setSharedAudioStatus("Synthesizing transcript and notes with Gemini 1.5 Flash...");
        const clientTimeZone =
          Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles";
        const response = await fetch("/api/voice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: user.uid,
            audioBase64: base64Data,
            mimeType: shared.audioType || "audio/m4a",
            clientTimeZone,
            sharedContext: {
              title: shared.title,
              text: shared.text,
              url: shared.url,
            },
          }),
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || "Failed to process shared audio recording.");
        }

        const data = await response.json();
        const createdNote: Note = data.note;

        // Persist to user subcollection
        await saveNote(user.uid, createdNote, createdNote.plain_text);
        await deleteSharedMediaPayload(shareIdParam);

        setSavedNote(createdNote);
      } catch (err: unknown) {
        console.error("Shared audio processing error:", err);
        const msg = err instanceof Error ? err.message : "Failed to process shared audio.";
        setError(msg);
      } finally {
        setProcessingSharedAudio(false);
        setSharedAudioStatus(null);
      }
    }

    processSharedAudio();
  }, [user, shareIdParam, audioSharedParam]);

  // Auto-save when URL/Text parameters are provided without audio
  useEffect(() => {
    if (!user?.uid || hasAutoSavedRef.current) return;
    // Don't auto-save if an audio file was shared or if in voice mode
    if (audioSharedParam || modeParam === "voice") return;

    const hasIncomingContent = Boolean(titleParam.trim() || textParam.trim() || urlParam.trim());
    if (!hasIncomingContent) return;

    hasAutoSavedRef.current = true;
    const timer = setTimeout(() => {
      executeSave(titleParam, textParam, urlParam);
    }, 0);
    return () => clearTimeout(timer);
  }, [user, titleParam, textParam, urlParam, audioSharedParam, modeParam, executeSave]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    executeSave(manualTitle, manualText, "");
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 min-h-[60vh] gap-3">
        <span className="loading loading-spinner loading-lg text-rose-500"></span>
        <span className="text-xs text-slate-400 font-mono tracking-wider">
          VERIFYING SESSION...
        </span>
      </div>
    );
  }

  // Not authenticated
  if (!user) {
    return (
      <div className="max-w-md mx-auto w-full flex-1 flex flex-col justify-center space-y-4 my-auto p-4">
        <div className="alert bg-amber-950/40 border border-amber-800/60 text-amber-200 text-sm shadow-lg rounded-2xl p-4">
          <svg className="w-5 h-5 shrink-0 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div>
            <h4 className="font-bold text-amber-100">Session Required</h4>
            <div className="text-xs text-amber-300/80">Sign in to save this shared content to your Second Brain.</div>
          </div>
        </div>
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl">
          <LoginForm />
        </div>
      </div>
    );
  }

  // Processing incoming shared audio file from Pixel Recorder
  if (processingSharedAudio) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 min-h-[60vh] gap-6 text-center max-w-md mx-auto w-full my-auto px-4">
        <div className="relative flex items-center justify-center w-20 h-20">
          <div className="absolute inset-0 rounded-full border-4 border-rose-500/20 animate-ping"></div>
          <span className="loading loading-spinner loading-lg text-rose-500"></span>
        </div>
        <div className="space-y-2">
          <h3 className="text-xl font-bold text-slate-100">Ingesting Pixel Audio...</h3>
          <p className="text-sm text-slate-400 animate-pulse">
            {sharedAudioStatus || "Transcribing & synthesizing with Gemini..."}
          </p>
        </div>
      </div>
    );
  }

  // Active Saving State
  if (saving) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 min-h-[60vh] gap-4 text-center max-w-md mx-auto w-full my-auto px-4">
        <span className="loading loading-spinner loading-lg text-rose-500"></span>
        <div className="space-y-1">
          <h3 className="text-xl font-bold text-slate-100">Saving to Second Brain...</h3>
          <p className="text-xs text-slate-400">Indexing your thought with Gemini...</p>
        </div>
      </div>
    );
  }

  // Successfully saved confirmation view
  if (savedNote) {
    const summary = extractSummary(savedNote);

    return (
      <div className="w-full max-w-lg mx-auto flex-1 flex flex-col justify-between animate-in fade-in zoom-in-95 duration-200 py-2">
        <div className="space-y-4 pt-2">
          {/* Clean Success Banner */}
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center text-xl shrink-0 shadow-sm">
              <svg className="w-6 h-6 stroke-current" fill="none" viewBox="0 0 24 24" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight text-slate-100">
                Saved to Second Brain
              </h2>
              <p className="text-xs text-slate-400">
                Indexed and stored in your knowledge base
              </p>
            </div>
          </div>

          {/* Note Preview Styled Card */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-xl backdrop-blur">
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                {savedNote.audioUrl && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-500/15 text-rose-300 border border-rose-500/30 shrink-0">
                    🎙️ Voice Memo
                  </span>
                )}
                {savedNote.tags?.includes("share-target") && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-500/15 text-blue-300 border border-blue-500/30 shrink-0">
                    🔗 Captured Link
                  </span>
                )}
              </div>
              <h3 className="font-bold text-lg text-slate-100 leading-snug">
                {savedNote.title}
              </h3>
            </div>

            {/* Audio Playback Player */}
            {savedNote.audioUrl && (
              <div className="pt-1">
                <audio
                  controls
                  src={savedNote.audioUrl}
                  className="w-full h-10 rounded-xl bg-slate-950 border border-slate-800"
                />
              </div>
            )}

            {/* AI-generated Summary */}
            {summary && (
              <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Summary
                </div>
                <p className="text-sm text-slate-300 leading-relaxed line-clamp-6">
                  {summary}
                </p>
              </div>
            )}

            {/* Tag pills */}
            {savedNote.tags && savedNote.tags.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap pt-2 border-t border-slate-800/80">
                {savedNote.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2.5 py-1 rounded-lg text-xs font-mono bg-slate-800 text-slate-300 border border-slate-700/60"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 1-Tap Voice Thought Append Area (Only for non-voice notes) */}
          {!savedNote.audioUrl && !savedNote.tags?.includes("voice-memo") && modeParam !== "voice" && (
            <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-2xl space-y-3">
              <div className="text-xs font-semibold text-rose-400">
                Want to add your spoken thoughts to this note?
              </div>

              {!isAppendingVoice ? (
                <button
                  type="button"
                  onClick={() => setIsAppendingVoice(true)}
                  className="w-full min-h-[48px] py-3 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-md transition-colors active:scale-[0.98]"
                >
                  <span className="text-base">🎙️</span>
                  Add Spoken Thought to this Note
                </button>
              ) : (
                <div className="p-4 bg-slate-950 rounded-xl border border-slate-800">
                  <VoiceRecorder
                    autoStart={true}
                    fullScreen={false}
                    targetNoteId={savedNote.id}
                    sharedContext={{
                      title: savedNote.title,
                      url: urlParam || undefined,
                      text: savedNote.plain_text,
                    }}
                    onNoteCreated={(updatedNote) => {
                      setSavedNote(updatedNote);
                      setIsAppendingVoice(false);
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Navigation Actions anchored at the bottom */}
        <div className="mt-auto pt-6 space-y-3 w-full">
          <Link
            href="/dashboard"
            className="w-full min-h-[52px] h-13 rounded-2xl bg-white hover:bg-slate-100 active:scale-[0.98] text-slate-950 font-bold text-base shadow-lg shadow-black/40 flex items-center justify-center gap-2 transition-all"
          >
            Return to Dashboard
          </Link>
          <button
            type="button"
            onClick={() => {
              setSavedNote(null);
              setManualTitle("");
              setManualText("");
              setIsAppendingVoice(false);
              setIsVoiceCaptureMode(modeParam === "voice");
              hasAutoSavedRef.current = false;
            }}
            className="w-full py-3 rounded-xl text-center text-sm font-medium text-slate-400 hover:text-slate-200 transition-colors"
          >
            Capture Another
          </button>
        </div>
      </div>
    );
  }

  // Instant Voice Capture Mode (Triggered by App Shortcut, Pixel Quick Tap, or Voice Toggle)
  if (isVoiceCaptureMode || modeParam === "voice") {
    return (
      <div className="w-full max-w-lg mx-auto flex-1 flex flex-col justify-between">
        <VoiceRecorder
          autoStart={autostartParam}
          fullScreen={true}
          onNoteCreated={(note) => {
            setSavedNote(note);
          }}
        />
      </div>
    );
  }

  // Fallback Manual One-Field Capture View (Rule 4)
  return (
    <div className="w-full max-w-lg mx-auto flex-1 flex flex-col justify-between py-2">
      <div className="bg-slate-900/80 border border-slate-800 shadow-xl rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl">⚡</span>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-slate-100">Quick Thought Capture</h2>
            <p className="text-xs text-slate-400">Instant capture to your Second Brain</p>
          </div>
        </div>

        {error && (
          <div className="p-3 text-xs bg-rose-950/50 border border-rose-800 text-rose-300 rounded-xl">
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleManualSubmit} className="space-y-3">
          <div>
            <input
              type="text"
              placeholder="Title (optional)..."
              value={manualTitle}
              onChange={(e) => setManualTitle(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-800 bg-slate-950 text-sm text-slate-100 placeholder-slate-500 focus:border-rose-500 outline-none"
            />
          </div>

          <div>
            <textarea
              placeholder="Type or paste a thought, link, or snippet..."
              rows={4}
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-800 bg-slate-950 text-sm text-slate-100 placeholder-slate-500 focus:border-rose-500 outline-none leading-relaxed"
              required
            />
          </div>

          <button
            type="submit"
            disabled={!manualText.trim()}
            className="w-full min-h-[48px] rounded-xl bg-white hover:bg-slate-100 active:scale-[0.98] text-slate-950 font-bold text-sm shadow-md transition-all disabled:opacity-50 disabled:pointer-events-none"
          >
            Save to Second Brain
          </button>
        </form>

        {/* Multimodal Voice Memo Quick Capture Switch */}
        <div className="relative flex py-2 items-center">
          <div className="flex-grow border-t border-slate-800"></div>
          <span className="flex-shrink mx-3 text-[10px] text-slate-500 uppercase tracking-widest font-mono">
            Or Record Voice Memo
          </span>
          <div className="flex-grow border-t border-slate-800"></div>
        </div>

        <button
          type="button"
          onClick={() => setIsVoiceCaptureMode(true)}
          className="w-full min-h-[48px] py-3 px-4 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 font-semibold text-sm flex items-center justify-center gap-2.5 transition-all active:scale-[0.98]"
        >
          <span className="text-base">🎙️</span>
          Switch to Instant Voice Capture
        </button>
      </div>

      <div className="mt-auto pt-4 text-center">
        <Link href="/dashboard" className="text-xs text-slate-400 hover:text-slate-200 transition-colors">
          ← Return to Dashboard
        </Link>
      </div>
    </div>
  );
}

export default function CapturePage() {
  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100 p-4 pb-8 flex flex-col justify-between">
      <Suspense
        fallback={
          <div className="flex flex-col items-center justify-center flex-1 min-h-[60vh] gap-3">
            <span className="loading loading-spinner loading-lg text-rose-500"></span>
            <span className="text-xs text-slate-400 font-mono tracking-wider">
              LOADING CAPTURE...
            </span>
          </div>
        }
      >
        <CaptureInner />
      </Suspense>
    </div>
  );
}
