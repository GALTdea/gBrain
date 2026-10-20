"use client";

import React, { Suspense, useEffect, useState, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { saveNote } from "@/lib/notes/notes-service";
import { Note } from "@/types/note";
import LoginForm from "@/components/auth/LoginForm";
import VoiceRecorder from "@/components/voice/VoiceRecorder";
import {
  getSharedMediaPayload,
  deleteSharedMediaPayload,
  SharedMediaPayload,
} from "@/lib/voice/voice-draft-store";

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
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <span className="loading loading-spinner loading-lg text-primary"></span>
        <span className="text-xs text-base-content/60 font-mono tracking-wider">
          VERIFYING SESSION...
        </span>
      </div>
    );
  }

  // Not authenticated
  if (!user) {
    return (
      <div className="max-w-md mx-auto w-full p-4 space-y-4">
        <div className="alert alert-warning text-sm shadow-lg">
          <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div>
            <h4 className="font-bold">Session Required</h4>
            <div className="text-xs">Sign in below to save this shared content to your Second Brain.</div>
          </div>
        </div>
        <LoginForm />
      </div>
    );
  }

  // Processing incoming shared audio file from Pixel Recorder
  if (processingSharedAudio) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 text-center p-6 max-w-md mx-auto">
        <div className="relative flex items-center justify-center w-16 h-16">
          <span className="loading loading-spinner loading-lg text-primary"></span>
        </div>
        <div>
          <h3 className="font-bold text-lg">Ingesting Pixel Audio...</h3>
          <p className="text-xs text-base-content/70 mt-1">
            {sharedAudioStatus || "Transcribing & synthesizing with Gemini..."}
          </p>
        </div>
      </div>
    );
  }

  // Active Saving State
  if (saving) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3 text-center p-4">
        <span className="loading loading-spinner loading-lg text-primary"></span>
        <h3 className="font-bold text-lg">Saving to Second Brain...</h3>
        <p className="text-xs text-base-content/60 font-mono">
          Writing note into users/{user.uid.slice(0, 8)}.../notes
        </p>
      </div>
    );
  }

  // Successfully saved view (Immediate link save + 1-tap voice append design)
  if (savedNote) {
    return (
      <div className="max-w-md mx-auto w-full p-4 animate-in fade-in zoom-in-95 duration-200">
        <div className="card bg-base-200/70 backdrop-blur border border-success/30 shadow-2xl overflow-hidden">
          <div className="card-body p-6 text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-success/15 text-success flex items-center justify-center text-2xl mx-auto ring-1 ring-success/30 shadow-lg shadow-success/10">
              ✓
            </div>

            <div>
              <h2 className="text-xl font-bold tracking-tight text-base-content">
                Saved to Second Brain!
              </h2>
              <p className="text-xs text-base-content/60 mt-0.5">
                Stored in users/{user.uid.slice(0, 8)}.../notes
              </p>
            </div>

            {/* Note Preview Card */}
            <div className="text-left bg-base-100/90 border border-base-300 rounded-xl p-3.5 space-y-2">
              <div className="flex items-center gap-1.5">
                {savedNote.audioUrl && (
                  <span className="badge badge-secondary badge-xs font-medium">
                    🎙️ Voice Memo
                  </span>
                )}
                <div className="font-bold text-sm text-base-content line-clamp-1">
                  {savedNote.title}
                </div>
              </div>

              {savedNote.audioUrl && (
                <div className="pt-1">
                  <audio
                    controls
                    src={savedNote.audioUrl}
                    className="w-full h-8 rounded opacity-90"
                  />
                </div>
              )}

              <p className="text-xs text-base-content/70 line-clamp-3 leading-relaxed">
                {savedNote.plain_text}
              </p>
              <div className="flex items-center gap-1.5 pt-1">
                {savedNote.tags?.map((tag) => (
                  <span key={tag} className="badge badge-primary badge-xs font-mono">
                    #{tag}
                  </span>
                ))}
              </div>
            </div>

            {/* 1-Tap Giant Voice Thought Append Area (Only shown for shared links/text, not voice memos) */}
            {!savedNote.audioUrl && !savedNote.tags?.includes("voice-memo") && modeParam !== "voice" && (
              <div className="p-3 bg-primary/10 border border-primary/25 rounded-2xl space-y-2">
                <div className="text-xs font-semibold text-primary">
                  Want to add your spoken thoughts to this?
                </div>

                {!isAppendingVoice ? (
                  <button
                    type="button"
                    onClick={() => setIsAppendingVoice(true)}
                    className="btn btn-primary btn-block rounded-xl font-bold gap-2 shadow-lg shadow-primary/20 active:scale-95 transition-all text-sm"
                  >
                    <span className="text-lg">🎙️</span>
                    Add Spoken Thought to this Note
                  </button>
                ) : (
                  <div className="flex flex-col items-center justify-center p-2 bg-base-100/80 rounded-xl">
                    <VoiceRecorder
                      autoStart={true}
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

            {/* Navigation Actions */}
            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <Link
                href="/dashboard"
                className="btn btn-neutral btn-sm flex-1 font-semibold"
              >
                Go to Dashboard
              </Link>
              <button
                type="button"
                onClick={() => {
                  setSavedNote(null);
                  setManualTitle("");
                  setManualText("");
                  setIsAppendingVoice(false);
                  hasAutoSavedRef.current = false;
                }}
                className="btn btn-outline btn-sm flex-1"
              >
                Capture Another
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Instant Voice Capture Mode (Triggered by App Shortcut or Pixel Quick Tap)
  if (modeParam === "voice") {
    return (
      <div className="max-w-md mx-auto w-full p-4">
        <div className="card bg-base-200/60 backdrop-blur border border-primary/30 shadow-2xl">
          <div className="card-body p-6 text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-primary/15 text-primary flex items-center justify-center text-3xl mx-auto ring-1 ring-primary/30 shadow-lg shadow-primary/10">
              🎙️
            </div>

            <div>
              <h2 className="text-xl font-bold tracking-tight">Instant Voice Capture</h2>
              <p className="text-xs text-base-content/60 mt-1">
                Speak your mind. Gemini will transcribe, summarize, and tag automatically.
              </p>
            </div>

            <div className="flex flex-col items-center justify-center p-4 bg-base-100/80 rounded-2xl border border-base-300">
              <VoiceRecorder
                autoStart={autostartParam}
                onNoteCreated={(note) => {
                  setSavedNote(note);
                }}
              />
            </div>

            <div className="pt-2">
              <Link href="/dashboard" className="text-xs text-base-content/60 hover:text-primary transition-colors">
                ← Return to Dashboard
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Fallback Manual One-Field Capture View (Rule 4)
  return (
    <div className="max-w-md mx-auto w-full p-4">
      <div className="card bg-base-200/50 backdrop-blur border border-base-300 shadow-xl">
        <div className="card-body p-6 sm:p-8 space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-2xl">⚡</span>
            <div>
              <h2 className="text-xl font-bold tracking-tight">Quick Thought Capture</h2>
              <p className="text-xs text-base-content/60">Instant capture to your Second Brain</p>
            </div>
          </div>

          {error && (
            <div className="alert alert-error text-xs py-2">
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleManualSubmit} className="space-y-3">
            <div className="form-control">
              <input
                type="text"
                placeholder="Title (optional)..."
                value={manualTitle}
                onChange={(e) => setManualTitle(e.target.value)}
                className="input input-bordered input-sm w-full bg-base-100 text-sm focus:input-primary"
              />
            </div>

            <div className="form-control">
              <textarea
                placeholder="Type or paste a thought, link, or snippet..."
                rows={4}
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                className="textarea textarea-bordered w-full bg-base-100 text-sm focus:textarea-primary leading-relaxed"
                required
              />
            </div>

            <button
              type="submit"
              disabled={!manualText.trim()}
              className="btn btn-primary btn-sm w-full font-semibold shadow-md gap-2"
            >
              Save to Second Brain
            </button>
          </form>

          {/* Multimodal Voice Memo Quick Capture */}
          <div className="divider text-[10px] text-base-content/40 my-1 uppercase tracking-wider font-mono">
            Or Record Voice Memo
          </div>

          <div className="flex flex-col items-center justify-center p-3 bg-base-100/50 rounded-xl border border-dashed border-base-300 gap-2">
            <span className="text-xs text-base-content/60 text-center">
              Dictate a note with multimodal Gemini 1.5 Flash transcription:
            </span>
            <VoiceRecorder
              onNoteCreated={(note) => {
                setSavedNote(note);
              }}
            />
          </div>

          <div className="text-center pt-2">
            <Link href="/dashboard" className="text-xs text-base-content/60 hover:text-primary transition-colors">
              ← Return to Dashboard
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CapturePage() {
  return (
    <AuthProvider>
      <div className="min-h-screen flex flex-col justify-between">
        <main className="w-full flex-1 flex items-center justify-center p-4">
          <Suspense
            fallback={
              <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
                <span className="loading loading-spinner loading-lg text-primary"></span>
                <span className="text-xs text-base-content/60 font-mono">LOADING CAPTURE...</span>
              </div>
            }
          >
            <CaptureInner />
          </Suspense>
        </main>
        <footer className="footer footer-center p-4 text-xs text-base-content/40 border-t border-base-300">
          <aside>
            <p>Second Brain PWA • Web Share Target API • Universal Frictionless Voice & Link Capture</p>
          </aside>
        </footer>
      </div>
    </AuthProvider>
  );
}
