"use client";

import React, { useState, useRef, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { storage, isFirebaseConfigured } from "@/lib/firebase/client";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { Note } from "@/types/note";
import { saveNote } from "@/lib/notes/notes-service";

interface VoiceRecorderProps {
  onNoteCreated?: (note: Note) => void;
  compact?: boolean; // For inline buttons vs full floating action bar
  className?: string;
}

/**
 * Detects the best supported audio MIME type across browsers (Android Chrome, iOS Safari, macOS, desktop).
 */
function getSupportedMimeType(): { mimeType: string; extension: string } {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
    return { mimeType: "audio/webm", extension: "webm" };
  }

  const types = [
    { mimeType: "audio/webm;codecs=opus", extension: "webm" },
    { mimeType: "audio/webm", extension: "webm" },
    { mimeType: "audio/mp4", extension: "mp4" },
    { mimeType: "audio/aac", extension: "aac" },
    { mimeType: "audio/ogg;codecs=opus", extension: "ogg" },
  ];

  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t.mimeType)) {
      return t;
    }
  }

  return { mimeType: "", extension: "webm" };
}

// Minimal TypeScript declarations for Web Speech API
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      [index: number]: { transcript: string };
    };
  };
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export default function VoiceRecorder({
  onNoteCreated,
  compact = false,
  className = "",
}: VoiceRecorderProps) {
  const { user } = useAuth();

  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [recordSeconds, setRecordSeconds] = useState<number>(0);
  const [liveTranscript, setLiveTranscript] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const isRecordingRef = useRef<boolean>(false);
  const finalTranscriptRef = useRef<string>("");
  const interimTranscriptRef = useRef<string>("");
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Clean up recording stream & timers on unmount
  useEffect(() => {
    return () => {
      isRecordingRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.onend = null;
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const startRecording = async () => {
    setErrorMessage(null);
    setStatusMessage(null);
    setLiveTranscript("");
    finalTranscriptRef.current = "";
    interimTranscriptRef.current = "";

    if (!navigator?.mediaDevices?.getUserMedia) {
      setErrorMessage("Audio recording is not supported in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const { mimeType } = getSupportedMimeType();
      const options = mimeType ? { mimeType } : undefined;

      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      // Start browser Web Speech API in parallel for instant live speech-to-text
      if (typeof window !== "undefined") {
        const SpeechRecognitionCtor =
          (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionInstance })
            .SpeechRecognition ||
          (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionInstance })
            .webkitSpeechRecognition;

        if (SpeechRecognitionCtor) {
          try {
            const recognition = new SpeechRecognitionCtor();
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.lang = navigator.language || "en-US";

            recognition.onresult = (event: SpeechRecognitionEvent) => {
              let interim = "";
              for (let i = event.resultIndex; i < event.results.length; i++) {
                const res = event.results[i];
                const text = res[0]?.transcript || "";
                if (res.isFinal) {
                  finalTranscriptRef.current += text + " ";
                } else {
                  interim += text;
                }
              }
              interimTranscriptRef.current = interim;
              const combined = `${finalTranscriptRef.current}${interim}`.trim();
              setLiveTranscript(combined);
            };

            recognition.onerror = () => {
              // Ignore non-fatal speech recognition errors
            };

            recognition.onend = () => {
              // Restart recognition if still actively recording
              if (isRecordingRef.current) {
                try {
                  recognition.start();
                } catch {
                  // ignore
                }
              }
            };

            recognition.start();
            recognitionRef.current = recognition;
          } catch (speechErr) {
            console.warn("Web Speech API initialization skipped:", speechErr);
          }
        }
      }

      mediaRecorder.start(250); // collect chunks every 250ms
      isRecordingRef.current = true;
      setIsRecording(true);
      setRecordSeconds(0);

      timerRef.current = setInterval(() => {
        setRecordSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err: unknown) {
      console.error("Microphone access error:", err);
      const msg =
        err instanceof Error
          ? err.message
          : "Could not access microphone. Please grant audio permissions.";
      setErrorMessage(msg);
      isRecordingRef.current = false;
      setIsRecording(false);
    }
  };

  const cancelRecording = () => {
    isRecordingRef.current = false;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    audioChunksRef.current = [];
    finalTranscriptRef.current = "";
    interimTranscriptRef.current = "";
    setLiveTranscript("");
    setIsRecording(false);
    setRecordSeconds(0);
    setStatusMessage(null);
  };

  const stopAndProcessRecording = async () => {
    if (!mediaRecorderRef.current || !isRecording) return;

    isRecordingRef.current = false;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }

    const capturedBrowserTranscript =
      `${finalTranscriptRef.current}${interimTranscriptRef.current}`.trim() ||
      liveTranscript.trim();

    setIsRecording(false);
    setIsProcessing(true);
    setStatusMessage("Finalizing audio recording...");

    const recorder = mediaRecorderRef.current;

    recorder.onstop = async () => {
      // Release microphone tracks
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }

      try {
        const { mimeType: detectedMimeType, extension } = getSupportedMimeType();
        const effectiveMimeType = recorder.mimeType || detectedMimeType || "audio/webm";
        const audioBlob = new Blob(audioChunksRef.current, {
          type: effectiveMimeType,
        });

        if (audioBlob.size < 100) {
          throw new Error("Recorded audio was too short or empty.");
        }

        const userId = user?.uid || "guest_user";
        const timestamp = Date.now();
        const fileName = `voice_${timestamp}.${extension}`;
        const storagePath = `users/${userId}/audio/${fileName}`;

        let downloadUrl = "";
        let audioStorageUri = "";

        // Attempt upload to Firebase Storage if configured (with a 4s timeout so unprovisioned Storage buckets don't hang)
        if (storage && isFirebaseConfigured && user && !user.uid.startsWith("usr_")) {
          try {
            setStatusMessage("Uploading audio to Firebase Storage...");
            const audioRef = ref(storage, storagePath);
            const uploadTask = (async () => {
              const uploadResult = await uploadBytes(audioRef, audioBlob, {
                contentType: effectiveMimeType,
              });
              return await getDownloadURL(uploadResult.ref);
            })();
            const timeoutTask = new Promise<string>((_, reject) =>
              setTimeout(() => reject(new Error("Firebase Storage upload timed out")), 4000)
            );
            downloadUrl = await Promise.race([uploadTask, timeoutTask]);

            const bucketName =
              process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
              storage.app.options.storageBucket ||
              "";
            if (bucketName) {
              audioStorageUri = `gs://${bucketName}/${storagePath}`;
            }
          } catch (uploadErr) {
            console.warn(
              "Firebase Storage upload deferred (falling back to direct audio analysis):",
              uploadErr
            );
          }
        }

        // Convert audio blob to base64 for fallback or direct inline analysis
        setStatusMessage("Converting audio for Gemini multimodal analysis...");
        const base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(audioBlob);
        });

        // Trigger /api/voice route for multimodal transcription and indexing
        setStatusMessage("Transcribing & synthesizing voice note...");
        const response = await fetch("/api/voice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            audioStorageUri: audioStorageUri || undefined,
            audioUrl: downloadUrl || undefined,
            audioBase64: base64Data,
            mimeType: effectiveMimeType,
            browserTranscript: capturedBrowserTranscript || undefined,
          }),
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || "Multimodal voice processing failed.");
        }

        const data = await response.json();
        const createdNote: Note = data.note;

        // Always persist via client-side saveNote so the authenticated user's session writes directly to Firestore
        await saveNote(userId, createdNote, createdNote.plain_text);

        setStatusMessage("Voice memo saved & transcribed successfully!");
        setTimeout(() => setStatusMessage(null), 3000);

        if (onNoteCreated) {
          onNoteCreated(createdNote);
        }
      } catch (err: unknown) {
        console.error("Voice processing error:", err);
        const msg =
          err instanceof Error ? err.message : "Failed to process audio memo.";
        setErrorMessage(msg);
      } finally {
        setIsProcessing(false);
        setRecordSeconds(0);
        setLiveTranscript("");
        finalTranscriptRef.current = "";
        interimTranscriptRef.current = "";
        audioChunksRef.current = [];
      }
    };

    recorder.stop();
  };

  // Rendering states:
  // 1. Processing state
  if (isProcessing) {
    return (
      <div
        className={`flex items-center gap-3 bg-base-200/90 border border-primary/30 px-4 py-2.5 rounded-2xl shadow-md ${className}`}
      >
        <span className="loading loading-spinner loading-sm text-primary"></span>
        <span className="text-xs font-medium text-base-content/80 animate-pulse">
          {statusMessage || "Processing voice memo with Gemini..."}
        </span>
      </div>
    );
  }

  // 2. Active recording state (pulsing red, live timer, stop & cancel buttons)
  if (isRecording) {
    return (
      <div
        className={`flex items-center gap-3 bg-error/10 border border-error/40 px-4 py-2 rounded-2xl shadow-lg backdrop-blur ${className}`}
      >
        {/* Pulsing red recording dot */}
        <div className="relative flex items-center justify-center w-4 h-4">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-error opacity-75"></span>
          <span className="relative inline-flex rounded-full h-3 w-3 bg-error"></span>
        </div>

        {/* Live timer */}
        <div className="font-mono text-xs font-semibold text-error tracking-wider">
          REC {formatTimer(recordSeconds)}
        </div>

        {/* Dynamic audio waves animation */}
        <div className="hidden sm:flex items-center gap-0.5 h-4">
          <span className="w-1 bg-error/60 rounded-full h-2 animate-pulse"></span>
          <span className="w-1 bg-error rounded-full h-4 animate-bounce"></span>
          <span className="w-1 bg-error/80 rounded-full h-3 animate-pulse"></span>
          <span className="w-1 bg-error rounded-full h-4 animate-bounce"></span>
        </div>

        {/* Live speech-to-text preview */}
        {liveTranscript && (
          <div className="max-w-[180px] sm:max-w-[260px] truncate text-xs text-base-content/80 italic">
            &ldquo;{liveTranscript}&rdquo;
          </div>
        )}

        <div className="flex items-center gap-2">
          {/* Stop and Save Button */}
          <button
            type="button"
            onClick={stopAndProcessRecording}
            className="btn btn-error btn-xs rounded-xl gap-1 text-white shadow-sm hover:scale-105 transition-all"
            title="Stop recording and transcribe note"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-3.5 h-3.5 fill-current"
              viewBox="0 0 24 24"
            >
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
            Done
          </button>

          {/* Cancel Button */}
          <button
            type="button"
            onClick={cancelRecording}
            className="btn btn-ghost btn-xs text-base-content/60 hover:text-base-content"
            title="Discard voice recording"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // 3. Idle state (Microphone button ready to record)
  return (
    <div className={`relative inline-flex flex-col items-start ${className}`}>
      {errorMessage && (
        <div className="absolute bottom-full mb-2 left-0 z-50 p-2 text-xs bg-error/15 border border-error/30 text-error rounded-xl max-w-xs shadow-md">
          {errorMessage}
          <button
            onClick={() => setErrorMessage(null)}
            className="ml-2 underline font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {statusMessage && (
        <div className="absolute bottom-full mb-2 left-0 z-50 p-2 text-xs bg-success/15 border border-success/30 text-success rounded-xl max-w-xs shadow-md">
          {statusMessage}
        </div>
      )}

      {compact ? (
        <button
          type="button"
          onClick={startRecording}
          className="btn btn-circle btn-sm btn-ghost border border-base-300 hover:border-primary/50 text-base-content/80 hover:text-primary transition-colors"
          title="Record Voice Memo"
          aria-label="Record Voice Memo"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
            />
          </svg>
        </button>
      ) : (
        <button
          type="button"
          onClick={startRecording}
          className="btn btn-sm btn-outline border-base-300 hover:border-primary hover:bg-primary/10 hover:text-primary rounded-xl gap-2 font-medium transition-all shadow-sm"
          title="Record Voice Memo with Gemini AI"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="w-4 h-4 text-primary"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
            />
          </svg>
          <span>Voice Memo</span>
        </button>
      )}
    </div>
  );
}

