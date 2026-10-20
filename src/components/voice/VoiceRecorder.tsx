"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { storage, isFirebaseConfigured } from "@/lib/firebase/client";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { Note } from "@/types/note";
import { saveNote } from "@/lib/notes/notes-service";
import {
  saveVoiceDraft,
  appendDraftChunk,
  deleteVoiceDraft,
  VoiceDraft,
} from "@/lib/voice/voice-draft-store";

interface VoiceRecorderProps {
  onNoteCreated?: (note: Note) => void;
  compact?: boolean;
  autoStart?: boolean; // Instantly start recording when loaded (e.g. from shortcut)
  targetNoteId?: string; // Append voice thought to this existing note
  sharedContext?: {
    title?: string;
    text?: string;
    url?: string;
  };
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

export default function VoiceRecorder({
  onNoteCreated,
  compact = false,
  autoStart = false,
  targetNoteId,
  sharedContext,
  className = "",
}: VoiceRecorderProps) {
  const { user } = useAuth();

  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [recordSeconds, setRecordSeconds] = useState<number>(0);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const isRecordingRef = useRef<boolean>(false);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const currentDraftIdRef = useRef<string | null>(null);

  // Request screen wake lock so recording is not terminated if screen dims
  const requestWakeLock = async () => {
    try {
      if ("wakeLock" in navigator && !wakeLockRef.current) {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
      }
    } catch (err) {
      console.warn("[VoiceRecorder] WakeLock request deferred:", err);
    }
  };

  const releaseWakeLock = () => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }
  };

  // Haptic feedback trigger
  const triggerHaptic = (ms = 40) => {
    if (typeof window !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate(ms);
      } catch {
        // ignore
      }
    }
  };

  // Clean up recording stream, wakeLock, audio analysis & timers on unmount
  useEffect(() => {
    return () => {
      isRecordingRef.current = false;
      releaseWakeLock();
      if (timerRef.current) clearInterval(timerRef.current);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
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

  const startRecording = useCallback(async () => {
    setErrorMessage(null);
    setStatusMessage(null);

    if (!navigator?.mediaDevices?.getUserMedia) {
      setErrorMessage("Audio recording is not supported in this browser.");
      return;
    }

    try {
      triggerHaptic(50);
      await requestWakeLock();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      // Realtime Audio Visualizer with AudioContext (avoids speech recognition locks)
      try {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
          const audioCtx = new AudioCtx();
          audioContextRef.current = audioCtx;
          const sourceNode = audioCtx.createMediaStreamSource(stream);
          const analyserNode = audioCtx.createAnalyser();
          analyserNode.fftSize = 64;
          sourceNode.connect(analyserNode);

          const dataArray = new Uint8Array(analyserNode.frequencyBinCount);
          const updateAudioLevel = () => {
            if (!isRecordingRef.current) return;
            analyserNode.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
              sum += dataArray[i];
            }
            const average = sum / dataArray.length;
            setAudioLevel(Math.min(100, Math.round((average / 128) * 100)));
            animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
          };
          updateAudioLevel();
        }
      } catch (audioCtxErr) {
        console.warn("[VoiceRecorder] AudioContext visualizer skipped:", audioCtxErr);
      }

      const { mimeType, extension } = getSupportedMimeType();
      const options = mimeType ? { mimeType } : undefined;

      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      // Create a persistent draft in IndexedDB
      const draftId = `draft_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      currentDraftIdRef.current = draftId;

      const initialDraft: VoiceDraft = {
        id: draftId,
        userId: user?.uid || "guest_user",
        chunks: [],
        mimeType: mediaRecorder.mimeType || mimeType || "audio/webm",
        extension,
        startedAt: Date.now(),
        durationSeconds: 0,
        status: "recording",
        targetNoteId,
        sharedContext,
      };
      await saveVoiceDraft(initialDraft);

      // Collect audio chunks every 1 second and immediately append to IndexedDB for crash safety
      let secondsCount = 0;
      mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
          appendDraftChunk(draftId, event.data, secondsCount);
        }
      };

      mediaRecorder.start(1000); // 1-second timeslice flush
      isRecordingRef.current = true;
      setIsRecording(true);
      setRecordSeconds(0);

      timerRef.current = setInterval(() => {
        secondsCount += 1;
        setRecordSeconds(secondsCount);
      }, 1000);
    } catch (err: unknown) {
      console.error("Microphone access error:", err);
      releaseWakeLock();
      const msg =
        err instanceof Error
          ? err.message
          : "Could not access microphone. Please grant audio permissions.";
      setErrorMessage(msg);
      isRecordingRef.current = false;
      setIsRecording(false);
    }
  }, [user, targetNoteId, sharedContext]);

  // Handle auto-start trigger on mount
  useEffect(() => {
    if (autoStart && !isRecording && !isProcessing) {
      const timer = setTimeout(() => {
        startRecording();
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [autoStart, isRecording, isProcessing, startRecording]);

  const cancelRecording = async () => {
    triggerHaptic(20);
    isRecordingRef.current = false;
    releaseWakeLock();

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (currentDraftIdRef.current) {
      await deleteVoiceDraft(currentDraftIdRef.current);
      currentDraftIdRef.current = null;
    }
    audioChunksRef.current = [];
    setIsRecording(false);
    setRecordSeconds(0);
    setAudioLevel(0);
    setStatusMessage(null);
  };

  const stopAndProcessRecording = async () => {
    if (!mediaRecorderRef.current || !isRecording) return;

    triggerHaptic(40);
    isRecordingRef.current = false;
    releaseWakeLock();

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    setIsRecording(false);
    setIsProcessing(true);
    setStatusMessage("Finalizing voice recording...");

    const recorder = mediaRecorderRef.current;
    const draftId = currentDraftIdRef.current;

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

        // Attempt upload to Firebase Storage if configured (with a 4s timeout so local dev doesn't hang)
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
        setStatusMessage("Transcribing & synthesizing note with Gemini...");
        const clientTimeZone =
          Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles";
        const response = await fetch("/api/voice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            audioStorageUri: audioStorageUri || undefined,
            audioUrl: downloadUrl || undefined,
            audioBase64: base64Data,
            mimeType: effectiveMimeType,
            clientTimeZone,
            targetNoteId,
            sharedContext,
          }),
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || "Multimodal voice processing failed.");
        }

        const data = await response.json();
        const createdNote: Note = data.note;

        // Persist via client-side saveNote to ensure Firestore subcollection write with client auth
        await saveNote(userId, createdNote, createdNote.plain_text);

        // Delete successful draft from IndexedDB
        if (draftId) {
          await deleteVoiceDraft(draftId);
        }

        triggerHaptic(60);
        setStatusMessage(
          targetNoteId
            ? "Voice thought appended successfully!"
            : "Voice memo synthesized & saved!"
        );
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
        setAudioLevel(0);
        audioChunksRef.current = [];
        currentDraftIdRef.current = null;
      }
    };

    recorder.stop();
  };

  // 1. Processing state
  if (isProcessing) {
    return (
      <div
        className={`flex items-center gap-3 bg-white border border-[#D8DEE9] px-4 py-2.5 rounded-2xl shadow-sm ${className}`}
      >
        <span className="loading loading-spinner loading-sm text-[#5E81AC]"></span>
        <span className="text-xs font-medium text-[#2E3440] animate-pulse">
          {statusMessage || "Processing voice memo with Gemini..."}
        </span>
      </div>
    );
  }

  // 2. Active recording state (Pulsing waveform, live timer, stop & cancel)
  if (isRecording) {
    return (
      <div
        className={`flex items-center justify-between gap-3 bg-rose-50 border border-rose-200 px-4 py-2.5 rounded-2xl shadow-sm backdrop-blur w-full max-w-md ${className}`}
      >
        <div className="flex items-center gap-2.5">
          {/* Pulsing red recording dot */}
          <div className="relative flex items-center justify-center w-4 h-4 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-600"></span>
          </div>

          {/* Live timer */}
          <div className="font-mono text-xs font-bold text-rose-700 tracking-wider">
            REC {formatTimer(recordSeconds)}
          </div>

          {/* Dynamic Audio Level Meter */}
          <div className="flex items-center gap-0.5 h-4 ml-1">
            <span
              className="w-1 bg-rose-500 rounded-full transition-all duration-75"
              style={{ height: `${Math.max(4, (audioLevel / 100) * 16)}px` }}
            />
            <span
              className="w-1 bg-rose-500 rounded-full transition-all duration-75"
              style={{ height: `${Math.max(4, ((audioLevel * 1.2) / 100) * 16)}px` }}
            />
            <span
              className="w-1 bg-rose-500 rounded-full transition-all duration-75"
              style={{ height: `${Math.max(4, ((audioLevel * 0.8) / 100) * 16)}px` }}
            />
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Stop and Save Button */}
          <button
            type="button"
            onClick={stopAndProcessRecording}
            className="btn btn-sm bg-rose-600 hover:bg-rose-700 border-none rounded-xl gap-1.5 text-white font-semibold shadow-sm active:scale-95 transition-all"
            title="Stop recording and transcribe note"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-4 h-4 fill-current"
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
            className="btn btn-ghost btn-xs text-[#64748B] hover:text-[#2E3440]"
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
        <div className="absolute bottom-full mb-2 left-0 z-50 p-2 text-xs bg-rose-50 border border-rose-200 text-rose-700 rounded-xl max-w-xs shadow-md">
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
        <div className="absolute bottom-full mb-2 left-0 z-50 p-2 text-xs bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl max-w-xs shadow-md">
          {statusMessage}
        </div>
      )}

      {compact ? (
        <button
          type="button"
          onClick={startRecording}
          className="btn btn-circle btn-sm btn-ghost border border-[#D8DEE9] hover:border-[#5E81AC] text-[#4C566A] hover:text-[#5E81AC] hover:bg-[#E5E9F0]/60 transition-colors"
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
          className="btn btn-sm btn-outline border-[#D8DEE9] text-[#2E3440] hover:border-[#5E81AC] hover:bg-blue-50/50 hover:text-[#5E81AC] rounded-xl gap-2 font-medium transition-all shadow-sm active:scale-95"
          title="Record Voice Memo with Gemini AI"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="w-4 h-4 text-[#5E81AC]"
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
