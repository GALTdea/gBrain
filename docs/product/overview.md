# Product Overview: Second Brain (`gBrain`)

## 1. Product Vision & Application Boundaries
**Second Brain (`gBrain`)** is a zero-cost, frictionless personal knowledge management Progressive Web App (PWA) built exclusively for **Gustavo and Gianna**.

### What gBrain Is:
* **Always-Reachable, Zero-Friction Capture:** 1-tap voice recording, OS share-sheet interception (Android/Pixel Web Share Target for links, text, and Pixel Recorder audio files), and quick-entry flows that capture thoughts instantly without cognitive load or filing decisions.
* **Dual-Paradigm Retrieval:**
  1. **Exploratory & Ideation Mode (AI/Vector RAG):** Semantic search and conversational synthesis across sprawling thoughts, problem-solving reflections, creative sparks, and saved web resources.
  2. **Deterministic Timeline & Audit Mode (Chronological Querying):** 100% complete, zero-dropped-entry date-range filtering for work logs, meeting records, incident tracking, and timesheet hour aggregation.

### What gBrain Is NOT (Application Boundaries):
* **Not an OS Alarm Clock or Calendar Event Manager:** Exact-minute time alarms and calendar appointments belong in native OS tools (Google Calendar, Apple Reminders) that have background push reliability.
* **Not a Rigid Database or Relational Spreadsheet:** Strict table schemas, multi-column databases, or multi-user grocery checkout lists introduce unnecessary filing friction.

Traditional note apps force users to choose between fast capture (like Google Keep or voice memos) and deep retrieval (like Notion or Obsidian). `gBrain` bridges that gap by combining zero-friction capture with rich TipTap block editing, 768-dimensional semantic RAG search, and deterministic chronological audit trails.

---

## 2. Target Users, Personas & Data Isolation
* **Users:** Gustavo and Gianna (2-user private system).
* **Primary User Personas & Workflows:**
  * **Gustavo (Creative & Problem-Solving Ideation Vault):** Walking thoughts, engineering epiphanies, architecture designs, creative ideas, and "open loops" to revisit later via Conversational RAG.
  * **Gianna (Frictionless Daily Union Work Log):** On-the-go voice documentation of shift events, member conversations, grievances, and work hours. Retrieved at the end of the week via **deterministic date-range filtering** (guaranteeing 0 dropped logs) and synthesized into weekly timesheet summaries.
* **Authentication Policy:** Open signups are disabled. Accounts are provisioned manually via Firebase Authentication (Email/Password and Google Sign-In) with persistent session storage.
* **Strict Data Isolation:** Both users share a single codebase and deployment, but their data is strictly isolated at the database and storage layer:
  * **Firestore:** Scoped to `users/{userId}/notes/{noteId}` where `request.auth.uid == userId`.
  * **Firebase Storage:** Scoped to `users/{userId}/audio/{fileName}` with a 25MB limit and `audio/*` MIME enforcement.
  * **Vector & Chronological Search:** All queries execute strictly within the authenticated user's `users/{userId}/notes` subcollection—preventing any cross-user data leakage.

---

## 3. Core User Journeys

### A. Central Dashboard & Omnibar Flow (`/dashboard`)
* Users land on a responsive masonry/grid dashboard of their notes sorted by `updatedAt` descending.
* **Unified Omnibar:** A single input bar at the top of the dashboard lets the user:
  * Filter notes in real time by title, body text, or `#tag`.
  * Press `Enter` to immediately quick-save the typed thought as a new note.
  * Click the editor icon (`📝`) to promote the typed text into the full TipTap rich-text editor.
  * Trigger an inline voice recording (`🎙️`) or switch to AI Conversational Search (`✨`).

### B. Rich Note Editing (`TipTapEditor`)
* Clicking any note card or "New Note" opens the TipTap editor.
* Supports headings (`H1`–`H3`), bold, italic, strikethrough, inline code, code blocks, blockquotes, and bullet/numbered lists.
* **Progressive Formatting Toolbar:** Hidden by default to keep the writing canvas clean; appears automatically when text is highlighted or when toggled via the `Aa` button.
* **Debounced Auto-Save:** Automatically saves changes 800ms after typing stops, persisting both raw TipTap JSON (`content`) and extracted `plain_text` while triggering background vector embedding generation if `plain_text` changed.

### C. Universal Frictionless Capture (`/capture` & Web Share Target)
* **Android / OS Share Sheet (`POST /capture-share-target` → `/capture`):**
  * Sharing a link or text snippet from any mobile app into Second Brain immediately saves the note upon session verification.
  * **1-Tap Spoken Thought Append:** Right after a shared link is saved on `/capture`, a prominent *"Add Spoken Thought to this Note"* button lets the user dictate why the link matters. Gemini synthesizes their voice commentary together with the shared link context and updates the note.
  * **Shared Audio Ingestion (e.g., Pixel Recorder):** Sharing an `.m4a`/audio file from an external recorder intercepts the binary via the Service Worker (`public/sw.js`), stores it in IndexedDB (`shared_media`), and automatically transcribes, summarizes, tags, and indexes it on `/capture`.
* **PWA App Shortcuts:** Long-pressing the app icon offers:
  * **"Instant Voice Note"** (`/capture?mode=voice&autostart=1`)
  * **"Log Work"** (`/capture?mode=voice&autostart=1&tag=union`) for 1-tap guaranteed tagging of work/union field notes.
  * **"Quick Text Capture"** (`/capture`).

### D. Multimodal Voice Capture (`VoiceRecorder`)
* Available from the Dashboard Omnibar, `/capture` page, or PWA shortcut.
* Acquires a screen WakeLock, displays a real-time Web Audio API frequency level meter, and flushes 1-second audio chunks to IndexedDB (`voice_drafts`) so recordings survive tab crashes or phone locks.
* Uploads audio to Firebase Storage (`users/{userId}/audio/`) and sends the audio to `/api/voice`, where Gemini produces:
  1. A concise 3–7 word **Title**.
  2. A 1–3 sentence **AI Summary**.
  3. A verbatim **Transcript**.
  4. Relevant **Tags** (including `#voice-memo` and any pre-assigned target tag like `#union`).

### E. Conversational RAG Search ("Search Your Brain")
* Users ask natural-language questions across their entire knowledge base.
* The system embeds the query (`768` dimensions), runs a hybrid retrieval pipeline (Firestore `findNearest` vector search + keyword/tag/title boosting), and synthesizes a structured answer via Gemini with explicit `[Note: Title]` citations and collapsible source cards showing match percentages.

### F. Deterministic Timeline Review & Timesheet Rollup
* **100% Complete Audit Trail:** When it's time to log weekly hours or review union documentation, users filter notes by **deterministic date ranges** (`Today`, `This Week`, `Last Week`, or custom date picker) combined with `#tag` filtering.
* **Direct Database Ordering:** Notes are rendered in chronological or reverse-chronological order directly from Firestore (`createdAt` index), guaranteeing zero missed entries or AI hallucination gaps.
* **1-Click Timesheet & Activity Rollup:** Users click *"✨ Summarize for Timesheet"*, and Gemini synthesizes an organized breakdown of hours worked, activities completed, and follow-ups pending, with links to the underlying audio recordings and transcripts.

