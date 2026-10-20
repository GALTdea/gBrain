# Stage 00: Completed Foundation (Phases 1–4 + Voice & Universal Capture)

* **Status:** Completed ✅
* **Date Baseline:** October 2026

---

## 1. Objectives
Establish the end-to-end foundation of `gBrain`—a private, zero-cost Second Brain PWA for Gustavo and Gianna—spanning authentication, strict Firestore/Storage multi-user isolation, rich TipTap block editing, PWA Web Share Target ingestion, multimodal voice recording/transcription, Google Keep migration seeding, and hybrid 768-dimensional vector RAG search.

---

## 2. Delivered Scope

### Phase 1: GCP Setup, Database & Auth
* Next.js `16.4` (App Router) initialized with Tailwind CSS `v4` and DaisyUI `v5`.
* Firebase Authentication configured in [`AuthContext.tsx`](file:///Users/gustavo/dev/projects/gBrain/src/context/AuthContext.tsx) and [`LoginForm.tsx`](file:///Users/gustavo/dev/projects/gBrain/src/components/auth/LoginForm.tsx) supporting Email/Password, Google Sign-In, `localStorage` session hydration (`gbrain_cached_auth_user`), and offline/demo user switching (`usr_gustavo_01`, `usr_gianna_02`).
* Strict user isolation enforced in [`firestore.rules`](file:///Users/gustavo/dev/projects/gBrain/firestore.rules) (`users/{userId}/notes/{noteId}`) and [`storage.rules`](file:///Users/gustavo/dev/projects/gBrain/storage.rules) (`users/{userId}/audio/{fileName}`, max 25MB, `audio/*`).

### Phase 2: The Editor & Dashboard
* Protected [`NotesDashboard.tsx`](file:///Users/gustavo/dev/projects/gBrain/src/components/dashboard/NotesDashboard.tsx) with responsive 3-column grid, tag filter pills, Unified Omnibar (instant filter + `Enter` quick-save + full editor launcher + compact voice recorder + AI search toggle), and floating action button (FAB).
* [`TipTapEditor.tsx`](file:///Users/gustavo/dev/projects/gBrain/src/components/editor/TipTapEditor.tsx) integrated with `@tiptap/starter-kit`, progressive formatting toolbar, tag editor, and 800ms debounced auto-save.
* Dual persistence of raw TipTap JSON (`content`) and `plain_text` in [`notes-service.ts`](file:///Users/gustavo/dev/projects/gBrain/src/lib/notes/notes-service.ts).

### Phase 3: PWA & Frictionless Capture
* Installable PWA configured via [`public/manifest.json`](file:///Users/gustavo/dev/projects/gBrain/public/manifest.json) with app shortcuts (`Instant Voice Note`, `Quick Text Capture`) and Web Share Target (`POST /capture-share-target`, `multipart/form-data`).
* Service Worker ([`public/sw.js`](file:///Users/gustavo/dev/projects/gBrain/public/sw.js)) + server fallback ([`src/app/capture-share-target/route.ts`](file:///Users/gustavo/dev/projects/gBrain/src/app/capture-share-target/route.ts)) + [`src/app/capture/page.tsx`](file:///Users/gustavo/dev/projects/gBrain/src/app/capture/page.tsx) supporting:
  * Immediate auto-save of shared links and text snippets.
  * 1-tap **"Add Spoken Thought to this Note"** post-capture voice append flow.
  * Shared audio file ingestion (e.g., from Pixel Recorder) via IndexedDB (`shared_media`).
  * Manual 1-field quick capture fallback.

### Phase 4: Vertex AI, RAG Search & Multimodal Voice
* **Vector Embedding Service ([`/api/embed`](file:///Users/gustavo/dev/projects/gBrain/src/app/api/embed/route.ts)):** Generates 768-dimensional embeddings via Gemini/Vertex AI (`text-embedding-004` / `gemini-embedding-001`) and writes `FieldValue.vector(embedding)` to `users/{userId}/notes/{noteId}` whenever `plain_text` changes.
* **Hybrid RAG Search ([`/api/search`](file:///Users/gustavo/dev/projects/gBrain/src/app/api/search/route.ts), [`ConversationalSearch.tsx`](file:///Users/gustavo/dev/projects/gBrain/src/components/search/ConversationalSearch.tsx)):** Queries Firestore `findNearest` (`limit: 30`, `COSINE`), falls back to over-fetching up to 250 recent notes if unindexed, applies hybrid tag (`+0.15`) and title (`+0.10`) score boosts, and synthesizes grounded answers with `[Note: Title]` citations via Gemini Flash.
* **Multimodal Voice Pipeline ([`VoiceRecorder.tsx`](file:///Users/gustavo/dev/projects/gBrain/src/components/voice/VoiceRecorder.tsx), [`voice-draft-store.ts`](file:///Users/gustavo/dev/projects/gBrain/src/lib/voice/voice-draft-store.ts), [`/api/voice`](file:///Users/gustavo/dev/projects/gBrain/src/app/api/voice/route.ts)):** Crash-safe 1s IndexedDB audio chunking, WakeLock, live Web Audio visualizer, Firebase Storage upload, and Gemini multimodal JSON synthesis (`title`, `summary`, `transcript`, `tags`).
* **Google Keep Seeder ([`/api/seed`](file:///Users/gustavo/dev/projects/gBrain/src/app/api/seed/route.ts)):** Parses [`data/lords_favor_restoration_notes.md`](file:///Users/gustavo/dev/projects/gBrain/data/lords_favor_restoration_notes.md), generates 768-dim embeddings in batches, and imports 80 notes into the user's subcollection.

