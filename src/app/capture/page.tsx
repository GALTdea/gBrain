"use client";

import React, { Suspense, useEffect, useState, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { saveNote } from "@/lib/notes/notes-service";
import { Note } from "@/types/note";
import LoginForm from "@/components/auth/LoginForm";

function CaptureInner() {
  const searchParams = useSearchParams();
  const { user, loading } = useAuth();

  const titleParam = searchParams.get("title") || "";
  const textParam = searchParams.get("text") || "";
  const urlParam = searchParams.get("url") || "";

  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState<Note | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Manual fallback inputs (Rule 4 fallback)
  const [manualTitle, setManualTitle] = useState(titleParam);
  const [manualText, setManualText] = useState(
    textParam ? (urlParam ? `${textParam}\n\n${urlParam}` : textParam) : urlParam
  );

  const hasAutoSavedRef = useRef(false);

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

  // Auto-save when URL parameters are provided and user is authenticated
  useEffect(() => {
    if (!user?.uid || hasAutoSavedRef.current) return;

    const hasIncomingContent = Boolean(titleParam.trim() || textParam.trim() || urlParam.trim());
    if (!hasIncomingContent) return;

    hasAutoSavedRef.current = true;
    const timer = setTimeout(() => {
      executeSave(titleParam, textParam, urlParam);
    }, 0);
    return () => clearTimeout(timer);
  }, [user, titleParam, textParam, urlParam, executeSave]);

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

  // Successfully saved view
  if (savedNote) {
    return (
      <div className="max-w-md mx-auto w-full p-4 animate-in fade-in zoom-in-95 duration-200">
        <div className="card bg-base-200/60 backdrop-blur border border-success/30 shadow-2xl overflow-hidden">
          <div className="card-body p-6 sm:p-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-success/15 text-success flex items-center justify-center text-3xl mx-auto ring-1 ring-success/30 shadow-lg shadow-success/10">
              ✓
            </div>

            <div>
              <h2 className="text-2xl font-bold tracking-tight text-base-content">
                Saved to Second Brain!
              </h2>
              <p className="text-xs text-base-content/60 mt-1">
                Captured and stored in your Firestore subcollection.
              </p>
            </div>

            {/* Note Preview Card */}
            <div className="text-left bg-base-100/80 border border-base-300 rounded-xl p-4 space-y-2">
              <div className="font-bold text-sm text-base-content line-clamp-1">
                {savedNote.title}
              </div>
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
              <div className="text-[10px] text-base-content/40 font-mono pt-1 border-t border-base-300/60">
                Path: users/{user.uid.slice(0, 8)}.../notes/{savedNote.id}
              </div>
            </div>

            {/* Navigation Actions */}
            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <Link
                href="/dashboard"
                className="btn btn-primary btn-sm flex-1 font-semibold shadow-md"
              >
                Go to Dashboard
              </Link>
              <button
                type="button"
                onClick={() => {
                  setSavedNote(null);
                  setManualTitle("");
                  setManualText("");
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
            <p>Second Brain PWA • Web Share Target API • Universal Frictionless Capture</p>
          </aside>
        </footer>
      </div>
    </AuthProvider>
  );
}

