# Product Features & Capabilities

This document catalogs the currently implemented features in `gBrain`, where they live in the codebase, and areas identified for future stages.

---

## 1. Implemented Features Matrix

### Authentication & Multi-User Isolation
* **Email/Password & Google OAuth Sign-In:** Managed via [`AuthContext.tsx`](file:///Users/gustavo/dev/projects/gBrain/src/context/AuthContext.tsx) and [`LoginForm.tsx`](file:///Users/gustavo/dev/projects/gBrain/src/components/auth/LoginForm.tsx).
* **Persistent Session Management:** Explicit browser IndexedDB persistence via `browserLocalPersistence` and global layout-level `<AuthProvider>` wrapper in [`layout.tsx`](file:///Users/gustavo/dev/projects/gBrain/src/app/layout.tsx), keeping user authenticated across page reloads.
* **Closed Signup Messaging:** Explicitly informs unauthorized users when an account is not found that open signups are disabled.

### Dashboard & Note Management
* **Real-Time Firestore Sync:** [`subscribeToUserNotes`](file:///Users/gustavo/dev/projects/gBrain/src/lib/notes/notes-service.ts#L42-L114) listens to `users/{userId}/notes` ordered by `updatedAt desc`, backed by Firestore `persistentLocalCache` (`persistentMultipleTabManager`) for offline resilience.
* **Unified Omnibar:** Combines instant search/filtering, `Enter`-to-quick-save, full-editor promotion, compact voice recording, and AI search mode toggling inside [`NotesDashboard.tsx`](file:///Users/gustavo/dev/projects/gBrain/src/components/dashboard/NotesDashboard.tsx#L360-L484).
* **Tag Filtering Bar:** Dynamically aggregates all unique `#tags` across the user's notes for 1-click filtering.
* **Special Voice Note Cards:** Voice notes automatically render an inline HTML5 `<audio>` player, a highlighted **✨ AI Summary** section, and a collapsible **Raw Transcript** accordion right on the dashboard card.
* **Google Keep Markdown Seeder (`/api/seed`):** One-click import button on the dashboard header that parses exported Keep notes from [`data/lords_favor_restoration_notes.md`](file:///Users/gustavo/dev/projects/gBrain/data/lords_favor_restoration_notes.md), preserves labels/timestamps/links, generates 768-dimensional embeddings in batches, and writes them to Firestore.

### Rich Block Editor (`TipTapEditor`)
* **Dual Content Representation:** Every save writes both raw TipTap `JSONContent` (`content`) and extracted `plain_text` via [`TipTapEditor.tsx`](file:///Users/gustavo/dev/projects/gBrain/src/components/editor/TipTapEditor.tsx).
* **Auto-Title Derivation:** Automatically derives a note title from the first line of content if left untitled.
* **Debounced Auto-Save (800ms):** Tracks `saved`, `saving`, `unsaved`, and `error` states, flushing pending changes automatically when navigating back to the dashboard.
* **Tag Management:** Inline tag addition (`Enter`) and removal with automatic `#` normalization.

### Frictionless Capture & PWA (`manifest.json`, `sw.js`, `/capture`)
* **Installable Standalone PWA:** Configured in [`public/manifest.json`](file:///Users/gustavo/dev/projects/gBrain/public/manifest.json) with light "Nord Snow" palette (`#ECEFF4` / `#5E81AC`), maskable icons, and app shortcuts.
* **Edge-to-Edge Mobile Layout:** Full-height `min-h-dvh` layout in a dark palette (`bg-slate-950 text-slate-100`) tailored for Android Chrome/PWA share target sessions with thumb-zone touch targets.
* **Thumb-Zone Voice Recording State:** Displays a large `text-5xl font-mono` live timer, an active pulsing recording badge, a full-width real-time Web Audio API waveform canvas, a massive high-contrast 56px `Done & Save` button anchored at the bottom, and a subtle `Cancel` option.
* **Polished Confirmation Cards:** Success banner with AI-generated title, extracted summary, tag pills in styled `bg-slate-900/80 border border-slate-800` cards, and anchored navigation buttons (`Return to Dashboard`, `Capture Another`).
* **Dual-Layer Web Share Target (`POST /capture-share-target`):**
  * **Primary Layer (Service Worker):** [`public/sw.js`](file:///Users/gustavo/dev/projects/gBrain/public/sw.js) intercepts `multipart/form-data` `POST` requests, stores shared text/URLs and binary audio files into IndexedDB (`gbrain_offline_store.shared_media`), and redirects (`303`) to `/capture`.
  * **Fallback Layer (Next.js Route):** [`src/app/capture-share-target/route.ts`](file:///Users/gustavo/dev/projects/gBrain/src/app/capture-share-target/route.ts) handles `POST`/`GET` requests if the Service Worker is inactive or warming up.
* **Post-Capture Voice Append:** After auto-saving a shared link or text snippet on [`src/app/capture/page.tsx`](file:///Users/gustavo/dev/projects/gBrain/src/app/capture/page.tsx), the user can tap **"Add Spoken Thought to this Note"** to record audio commentary that merges with the shared link context.

### Multimodal Voice Intelligence
* **Crash-Safe Recording:** [`VoiceRecorder.tsx`](file:///Users/gustavo/dev/projects/gBrain/src/components/voice/VoiceRecorder.tsx) and [`voice-draft-store.ts`](file:///Users/gustavo/dev/projects/gBrain/src/lib/voice/voice-draft-store.ts) flush 1-second `MediaRecorder` blobs to IndexedDB (`voice_drafts`) and hold a screen WakeLock.
* **Cross-Platform MIME Normalization:** Automatically selects the best supported recording format (`audio/webm;codecs=opus`, `audio/mp4`, `audio/aac`, `audio/ogg`) and normalizes MIME headers before calling Gemini so codec strings never cause `400` errors.
* **Multimodal Synthesis (`/api/voice`):** Uses Gemini (`processMultimodalVoiceMemo`) to generate structured JSON (`title`, `summary`, `transcript`, `tags`), formats a rich TipTap document with links to the audio file and any referenced URL, and embeds the combined text.

### Conversational RAG Search (Exploratory Retrieval)
* **Hybrid Retrieval Pipeline (`/api/search`, aliased at `/api/rag` & `/api/chat`):**
  1. Generates a 768-dimensional query vector via `text-embedding-004` / `gemini-embedding-001`.
  2. Executes Firestore `findNearest` (`limit: 30`, `COSINE` distance) on `users/{userId}/notes`.
  3. Falls back to over-fetching up to 250 recent notes (`orderBy("updatedAt", "desc")`) or client-passed `localNotes` if the composite vector index is still building or offline.
  4. Applies **Hybrid Scoring**: combines cosine similarity with a `+0.15` exact `#tag` match boost and `+0.10` title keyword match boost.
* **Grounded Answer Synthesis (`ConversationalSearch.tsx`):** Displays real-time progress steps, renders Gemini's synthesized answer with `[Note: Title]` citations, shows whether `findNearest` or cosine ranking was used, and provides expandable source cards with percentage match badges and direct "Open Note" links.

---

## 2. Planned Stage 1: Deterministic Timeline & Timesheet Rollup
Designed for high-certainty documentation (e.g. Gianna's union logs, timesheet preparation, and chronological audit trails):
* **Hard-Locked Context Capture (`/capture?tag=union`):** Dedicated PWA shortcut ("Log Work") and query parameter that automatically stamps incoming voice notes with a guaranteed target tag (`#union` / `#work-log`) with zero manual effort.
* **Deterministic Date-Range Filter Bar:** Interactive filter on the Dashboard (`[ All ]`, `[ Today ]`, `[ This Week ]`, `[ Last Week ]`, `[ Custom Range 📅 ]`) querying Firestore by timestamp (`createdAt`), guaranteeing 100% complete retrieval without fuzzy vector drop-offs.
* **End-of-Week Timesheet / Activity Synthesis (`/api/timesheet`):** 1-click button on filtered views that passes the exact verified notes to Gemini, generating a formatted weekly activity log and hours breakdown with direct links to audio recordings.

---

## 3. Known Gaps & Candidates for Future Stages
* **Pending Voice Draft Recovery UI:** [`getPendingVoiceDrafts()`](file:///Users/gustavo/dev/projects/gBrain/src/lib/voice/voice-draft-store.ts#L156-L174) exists in `voice-draft-store.ts` to find interrupted recordings in IndexedDB, but there is no UI banner in the Dashboard yet to replay/retry syncing an interrupted draft on next app launch.
* **Server-Side Auth Token Verification on API Routes:** API routes (`/api/embed`, `/api/search`, `/api/voice`, `/api/seed`) currently accept `userId` in the JSON request body and sanitize path segments. Adding Firebase ID token (`Authorization: Bearer <token>`) verification via `firebase-admin` on the server would harden API security to match the client-side Firestore/Storage rules.
* **Pinning & Archiving Notes:** Imported Keep notes tag pinned items with `#pinned`, but the Dashboard grid does not yet separate Pinned notes into a top section or support archiving.
* **Image / File Attachments in Editor:** `storage.rules` currently scopes rules to `users/{userId}/audio/{fileName}`; expanding storage rules and TipTap extensions to support inline images/screenshots is a natural future stage.
* **Brainstormed Roadmap Candidates:** See [`docs/product/potential-features.md`](./potential-features.md) for detailed analysis and evaluation matrices on Living Lists, Calendar Deep Links, In-Flight Context Pills, and Timesheet Synthesis.

