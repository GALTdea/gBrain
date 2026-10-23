"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
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
  onCancel?: () => void;
  compact?: boolean;
  fullScreen?: boolean;
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
  onCancel,
  compact = false,
  fullScreen,
  autoStart = false,
  targetNoteId,
  sharedContext,
  className = "",
}: VoiceRecorderProps) {
  const isFullScreen = fullScreen ?? !compact;
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
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hasAutoStartedRef = useRef<boolean>(false);

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
          analyserNode.fftSize = 128;
          sourceNode.connect(analyserNode);

          const dataArray = new Uint8Array(analyserNode.frequencyBinCount);

          const drawWaveform = () => {
            const canvas = waveformCanvasRef.current;
            if (!canvas) return;

            const dpr = window.devicePixelRatio || 1;
            const width = canvas.clientWidth;
            const height = canvas.clientHeight;
            if (width === 0 || height === 0) return;

            if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
              canvas.width = Math.floor(width * dpr);
              canvas.height = Math.floor(height * dpr);
            }

            const ctx = canvas.getContext("2d");
            if (!ctx) return;

            ctx.save();
            ctx.scale(dpr, dpr);
            ctx.clearRect(0, 0, width, height);

            // Responsive number of bars across the screen width
            const numBars = Math.min(48, Math.max(28, Math.floor(width / 7.5)));
            const barWidth = 4;
            const totalBarWidth = numBars * barWidth;
            const gap = Math.max(2, (width - totalBarWidth) / (numBars - 1));
            const centerY = height / 2;

            for (let i = 0; i < numBars; i++) {
              // Symmetrical wave mirroring from center outwards
              const normDist = Math.abs(i - (numBars - 1) / 2) / ((numBars - 1) / 2);
              const binIdx = Math.min(
                dataArray.length - 1,
                Math.floor((1 - normDist * 0.7) * (dataArray.length * 0.65))
              );
              const byteVal = dataArray[binIdx] || 0;
              const factor = byteVal / 255;

              // Baseline idle height + dynamic audio amplitude
              const minHeight = 6;
              const maxHeight = height * 0.85;
              const barHeight = Math.max(minHeight, factor * maxHeight);

              const x = i * (barWidth + gap);
              const y = centerY - barHeight / 2;

              // Glowing vibrant gradient
              const grad = ctx.createLinearGradient(0, y, 0, y + barHeight);
              grad.addColorStop(0, "rgba(244, 63, 94, 0.75)"); // rose-500
              grad.addColorStop(0.5, "rgba(251, 113, 133, 1)"); // rose-400
              grad.addColorStop(1, "rgba(244, 63, 94, 0.75)");

              ctx.fillStyle = grad;
              const radius = barWidth / 2;

              ctx.beginPath();
              if (typeof ctx.roundRect === "function") {
                ctx.roundRect(x, y, barWidth, barHeight, radius);
              } else {
                ctx.rect(x, y, barWidth, barHeight);
              }
              ctx.fill();
            }

            ctx.restore();
          };

          const updateAudioLevel = () => {
            if (!isRecordingRef.current) return;
            analyserNode.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
              sum += dataArray[i];
            }
            const average = sum / dataArray.length;
            setAudioLevel(Math.min(100, Math.round((average / 128) * 100)));
            drawWaveform();
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

  // Handle auto-start trigger on mount (strictly once per mount)
  useEffect(() => {
    if (autoStart && !hasAutoStartedRef.current && !isRecording && !isProcessing) {
      hasAutoStartedRef.current = true;
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

    if (onCancel) {
      onCancel();
    }
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
    setStatusMessage("Saving voice memo...");

    const recorder = mediaRecorderRef.current;
    const draftId = currentDraftIdRef.current;

    recorder.onstop = async () => {
      // Release microphone tracks immediately
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
        const noteId =
          targetNoteId ||
          draftId ||
          `voice_${timestamp}_${Math.random().toString(36).substring(2, 7)}`;
        const fileName = `voice_${timestamp}.${extension}`;
        const storagePath = `users/${userId}/audio/${fileName}`;

        // Create instant local playback URL for immediate UI responsiveness
        const localAudioUrl = URL.createObjectURL(audioBlob);

        const timeString = new Date(timestamp).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        });
        const placeholderTitle = sharedContext?.title
          ? `Voice thought on "${sharedContext.title}"`
          : `Voice Memo • ${timeString}`;

        const placeholderNote: Note = {
          id: noteId,
          title: placeholderTitle,
          content: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "Transcribing and synthesizing note with Gemini...",
                  },
                ],
              },
            ],
          },
          plain_text: "Transcribing and synthesizing note with Gemini...",
          tags: ["voice-memo"],
          status: "processing",
          audioUrl: localAudioUrl,
          userId,
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        // 1. Instantly persist placeholder note into Firestore subcollection
        await saveNote(userId, placeholderNote, placeholderNote.plain_text);

        // 2. Immediate user confirmation & release UI (< 500ms total)
        triggerHaptic(60);
        if (onNoteCreated) {
          onNoteCreated(placeholderNote);
        }

        // Clean up recorder controls and dismiss UI immediately
        setIsProcessing(false);
        setStatusMessage(null);
        setRecordSeconds(0);
        setAudioLevel(0);
        audioChunksRef.current = [];
        currentDraftIdRef.current = null;

        // 3. Asynchronous decoupled background synthesis
        (async () => {
          let downloadUrl = localAudioUrl;
          let audioStorageUri = "";

          try {
            // Upload audio to Firebase Storage if configured
            if (storage && isFirebaseConfigured && user) {
              try {
                const audioRef = ref(storage, storagePath);
                const uploadResult = await uploadBytes(audioRef, audioBlob, {
                  contentType: effectiveMimeType,
                });
                downloadUrl = await getDownloadURL(uploadResult.ref);

                const bucketName =
                  process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
                  storage.app.options.storageBucket ||
                  "";
                if (bucketName) {
                  audioStorageUri = `gs://${bucketName}/${storagePath}`;
                }

                // Update placeholder note with permanent Firebase Storage URL
                await saveNote(userId, {
                  ...placeholderNote,
                  audioUrl: downloadUrl,
                  audioStorageUri: audioStorageUri || undefined,
                });
              } catch (uploadErr) {
                console.warn(
                  "[VoiceRecorder] Storage upload deferred, proceeding with base64:",
                  uploadErr
                );
              }
            }

            // Convert audio blob to base64 for direct multimodal synthesis
            const base64Data = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(audioBlob);
            });

            const clientTimeZone =
              Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles";

            const response = await fetch("/api/voice", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                userId,
                noteId,
                audioStorageUri: audioStorageUri || undefined,
                audioUrl: downloadUrl,
                audioBase64: base64Data,
                mimeType: effectiveMimeType,
                clientTimeZone,
                targetNoteId,
                sharedContext,
              }),
              keepalive: true,
            });

            if (!response.ok) {
              const errData = await response.json().catch(() => ({}));
              throw new Error(errData.error || "Multimodal voice processing failed.");
            }

            const data = await response.json();
            const completedNote: Note = data.note;

            // Update local fallback store if Firebase client is unconfigured
            if (!isFirebaseConfigured) {
              await saveNote(userId, completedNote, completedNote.plain_text);
            }

            // Clean up IndexedDB draft upon verified synthesis
            if (draftId) {
              await deleteVoiceDraft(draftId);
            }
          } catch (bgErr: unknown) {
            console.error("[VoiceRecorder] Background synthesis error:", bgErr);
            const isOffline =
              (typeof navigator !== "undefined" && !navigator.onLine) ||
              (bgErr instanceof TypeError && bgErr.message.toLowerCase().includes("fetch")) ||
              (bgErr instanceof Error && bgErr.message.toLowerCase().includes("offline"));

            const errMsg = isOffline
              ? "Offline • Audio saved locally. Ready to synthesize when connected."
              : bgErr instanceof Error
              ? bgErr.message
              : "Failed to synthesize voice memo";

            await saveNote(userId, {
              ...placeholderNote,
              status: isOffline ? "queued" : "failed",
              processingError: errMsg,
            }).catch(() => {});
          }
        })();
      } catch (err: unknown) {
        console.error("Voice processing error:", err);
        const msg =
          err instanceof Error ? err.message : "Failed to process audio memo.";
        setErrorMessage(msg);
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
    if (isFullScreen) {
      return (
        <div
          className={`flex flex-col items-center justify-center flex-1 h-full min-h-[70vh] gap-6 text-center max-w-md mx-auto w-full my-auto px-4 ${className}`}
        >
          <div className="relative flex items-center justify-center w-20 h-20">
            <div className="absolute inset-0 rounded-full border-4 border-rose-500/20 animate-ping"></div>
            <span className="loading loading-spinner loading-lg text-rose-500"></span>
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-bold text-slate-100">Synthesizing Note...</h3>
            <p className="text-sm text-slate-400 max-w-xs mx-auto animate-pulse">
              {statusMessage || "Gemini 1.5 Flash is transcribing and organizing your thoughts..."}
            </p>
          </div>
        </div>
      );
    }

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
    if (isFullScreen) {
      return (
        <div
          className={`flex flex-col justify-between flex-1 h-full min-h-[75vh] w-full max-w-lg mx-auto py-2 ${className}`}
        >
          {/* Upper-Middle Area: Active Pulsing Recording Badge & 5xl Timer */}
          <div className="flex flex-col items-center justify-center pt-8 sm:pt-12 space-y-4">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-400 text-xs font-semibold uppercase tracking-widest shadow-sm">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500"></span>
              </span>
              <span>Recording</span>
            </div>

            <div className="text-5xl font-mono font-bold tracking-tight text-white drop-shadow-sm select-none">
              {formatTimer(recordSeconds)}
            </div>

            <p className="text-xs text-slate-400 font-medium">
              Listening to your thoughts...
            </p>
          </div>

          {/* Middle Area: Full-width animated audio waveform */}
          <div className="w-full flex-1 flex flex-col items-center justify-center py-6 px-2">
            <canvas
              ref={waveformCanvasRef}
              className="w-full h-28 sm:h-36 max-w-md mx-auto block"
            />
          </div>

          {/* Bottom Area (Thumb Zone): Massive Done & Save and Cancel buttons */}
          <div className="w-full space-y-3 mt-auto pt-4 pb-2">
            <button
              type="button"
              onClick={stopAndProcessRecording}
              className="w-full min-h-[56px] h-14 rounded-2xl bg-white hover:bg-slate-100 active:scale-[0.98] text-slate-950 font-bold text-lg shadow-xl shadow-black/50 flex items-center justify-center gap-2.5 transition-all"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-5 h-5 fill-current text-rose-600"
                viewBox="0 0 24 24"
              >
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
              <span>Done & Save</span>
            </button>

            <button
              type="button"
              onClick={cancelRecording}
              className="w-full py-2.5 text-center text-sm font-medium text-slate-400 hover:text-slate-200 transition-colors active:scale-[0.98]"
            >
              Cancel
            </button>
          </div>
        </div>
      );
    }

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
  if (isFullScreen) {
    return (
      <div
        className={`flex flex-col justify-between flex-1 h-full min-h-[75vh] w-full max-w-lg mx-auto py-2 ${className}`}
      >
        {errorMessage && (
          <div className="mb-4 p-3 text-xs bg-rose-950/50 border border-rose-800 text-rose-300 rounded-xl flex items-center justify-between">
            <span>{errorMessage}</span>
            <button
              onClick={() => setErrorMessage(null)}
              className="ml-2 font-bold hover:text-white"
            >
              ✕
            </button>
          </div>
        )}

        {statusMessage && (
          <div className="mb-4 p-3 text-xs bg-emerald-950/50 border border-emerald-800 text-emerald-300 rounded-xl">
            {statusMessage}
          </div>
        )}

        {/* Upper Area */}
        <div className="flex flex-col items-center justify-center pt-8 sm:pt-12 text-center space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-slate-900 border border-slate-800 text-rose-400 flex items-center justify-center text-2xl shadow-inner">
            🎙️
          </div>
          <div className="space-y-1">
            <h2 className="text-2xl font-bold tracking-tight text-slate-100">
              Instant Voice Capture
            </h2>
            <p className="text-xs text-slate-400 max-w-xs mx-auto leading-relaxed">
              Speak your mind. Gemini will transcribe, summarize, and tag automatically.
            </p>
          </div>
        </div>

        {/* Middle Area: Big Pulsing Central Mic Button */}
        <div className="w-full flex-1 flex flex-col items-center justify-center py-6">
          <button
            type="button"
            onClick={startRecording}
            className="relative group p-6 rounded-full bg-rose-500/10 border-2 border-rose-500/30 hover:border-rose-500/60 active:scale-95 transition-all shadow-2xl flex items-center justify-center"
            title="Tap to Start Recording"
            aria-label="Tap to Start Recording"
          >
            <span className="absolute inset-0 rounded-full bg-rose-500/10 animate-ping opacity-50"></span>
            <div className="w-20 h-20 rounded-full bg-rose-600 group-hover:bg-rose-500 text-white flex items-center justify-center shadow-lg transition-colors">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-10 h-10"
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
            </div>
          </button>
          <span className="text-xs text-slate-400 mt-4 font-medium">
            Tap microphone to start recording
          </span>
        </div>

        {/* Bottom Area */}
        <div className="w-full space-y-3 mt-auto pt-4 pb-2">
          <Link
            href="/dashboard"
            className="w-full py-3 block text-center text-sm font-medium text-slate-400 hover:text-slate-200 transition-colors"
          >
            ← Return to Dashboard
          </Link>
        </div>
      </div>
    );
  }

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
          className="btn btn-sm btn-outline border-slate-700 text-slate-200 hover:border-rose-500 hover:bg-rose-500/10 hover:text-rose-400 rounded-xl gap-2 font-medium transition-all shadow-sm active:scale-95"
          title="Record Voice Memo with Gemini AI"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="w-4 h-4 text-rose-400"
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
