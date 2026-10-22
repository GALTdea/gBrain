# Stage 02: Asynchronous Voice Note Synthesis & Optimistic Capture

* **Status:** Completed
* **Created:** 2026-10-22
* **Completed:** 2026-10-22

---

## 1. Objectives
Transition voice note ingestion from a blocking, synchronous flow (which locked the mobile UI behind a 10–15s spinner while Gemini 1.5 Flash synthesized and embedded audio) into a frictionless, sub-500ms **Optimistic Voice Capture & Real-Time Background Synthesis** architecture.

This removes the greatest mobile friction point for a personal Second Brain: the need to keep the screen active and stare at a loading modal after recording a quick thought on the go.

---

## 2. Scope & Deliverables
* [x] **Note Status Schema Extension (`src/types/note.ts`):**
  * Added `NoteProcessingStatus` (`"ready" | "processing" | "failed"`) and `processingError?: string` to `Note`.
* [x] **Notes Service Support (`src/lib/notes/notes-service.ts`):**
  * Extended `saveNote()` and `onSnapshot` real-time listeners to persist and broadcast `status` and `processingError`.
  * Skips unnecessary vector embedding passes when a placeholder note is initially stashed in `"processing"` state.
* [x] **Optimistic Capture Flow (`src/components/voice/VoiceRecorder.tsx`):**
  * On tapping "Stop Recording", instantly creates a placeholder note with `status: "processing"`, fires haptic confirmation, invokes `onNoteCreated(placeholderNote)`, and dismisses the recorder in **< 500ms**.
  * Decouples audio upload, Gemini multimodal transcription, summarization, and embedding into a background execution thread (`keepalive: true`).
* [x] **Backend Decoupled Synthesis (`src/app/api/voice/route.ts`):**
  * Ingests audio, executes Gemini 1.5 Flash multimodal synthesis and Vertex AI 768-dim embedding.
  * Updates existing Firestore note in `users/{userId}/notes/{noteId}` to `status: "ready"` with synthesized title, TipTap content, summary, tags, and vector embedding.
  * Catches synthesis failures and records `status: "failed"` with `processingError` in Firestore to avoid hung states while preserving audio.
* [x] **Dashboard Real-Time Feedback (`src/components/dashboard/NotesDashboard.tsx`):**
  * Note cards dynamically render an animated pulsing `[🎙️ Synthesizing...]` badge and skeleton placeholder while `status === "processing"`.
  * HTML5 audio player remains immediately interactive so recordings can be played back immediately.
  * Automatically flips to full AI summary, tags, and transcript via Firestore `onSnapshot` without page refresh.
  * Adds `[⚠️ Failed - Retry]` badge with a 1-tap `handleRetrySynthesis` handler.
  * Syncs active editing note state through clean memoization without cascading renders.
* [x] **TipTap Editor Integration (`src/components/editor/TipTapEditor.tsx`):**
  * Added non-intrusive status banners when viewing a note currently synthesizing or one that failed.
* [x] **Share Target Alignment (`src/app/capture/page.tsx`):**
  * Applied the same instant stash and background synthesis flow to shared audio files from Pixel Recorder.

---

## 3. Architectural Constraints & Decisions
* **Strict Firestore Subcollection Isolation:** All placeholder creation and background synthesis updates are scoped to `users/{userId}/notes/{noteId}`.
* **Separation of Content:** Notes preserve raw TipTap JSON and `plain_text`.
* **Zero UI Blocking:** Time from tapping "Stop" to UI dismissal reduced from ~10–15s to **< 500ms**.
* **Audio Preservation:** Audio files and local blobs are preserved even if LLM synthesis fails or network drops.

---

## 4. Verification & Acceptance Criteria
* [x] TypeScript & ESLint checks pass (`npm run lint`: 0 errors).
* [x] Next.js production build succeeds (`npm run build`: code 0).
* [x] Architecture and product documentation updated to reflect the as-built asynchronous flow.

---

## 5. Implementation Summary
* **Changes Made:**
  * Updated `src/types/note.ts` with `NoteProcessingStatus`.
  * Updated `src/lib/notes/notes-service.ts` to map and persist `status` and `processingError`.
  * Updated `src/app/api/voice/route.ts` to update existing documents in-place and record errors.
  * Updated `src/components/voice/VoiceRecorder.tsx` with optimistic capture and fire-and-forget background synthesis.
  * Updated `src/components/dashboard/NotesDashboard.tsx` with pulsing card badges, skeleton preview, derived editing note state, and 1-tap retry.
  * Updated `src/components/editor/TipTapEditor.tsx` with status alert banners.
  * Updated `src/app/capture/page.tsx` with instant stash for shared audio memos.
* **Tests & Verification:** Clean builds and linting across all modified routes and components.

