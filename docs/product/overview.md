# Product Overview: Second Brain (`gBrain`)

## 1. Product Vision & Philosophy
**Second Brain (`gBrain`)** is a zero-cost, frictionless personal knowledge management Progressive Web App (PWA) built exclusively for **Gustavo and Gianna**.

Traditional note-taking apps force users to choose between fast capture (like Google Keep or voice memos) and deep retrieval (like Notion or Obsidian). `gBrain` bridges that gap by combining:
1. **Zero-Friction Capture:** 1-tap voice recording, OS share-sheet interception (Android/Pixel Web Share Target for links, text, and Pixel Recorder audio files), and an omnibar quick-entry flow.
2. **Structured Rich Editing:** A clean, distraction-free block editor powered by TipTap with automatic background saving.
3. **AI-Powered Synthesis & Retrieval:** Automatic 768-dimensional semantic indexing and multimodal Gemini analysis that turns raw notes, shared links, and spoken thoughts into a conversational knowledge base with grounded citations.

---

## 2. Target Users & Multi-User Isolation Model
* **Users:** Gustavo and Gianna (2-user private system).
* **Authentication Policy:** Open signups are disabled. Accounts are provisioned manually via Firebase Authentication (Email/Password and Google Sign-In) with persistent session storage.
* **Strict Data Isolation:** Both users share a single codebase and deployment, but their data is strictly isolated at the database and storage layer:
  * **Firestore:** Scoped to `users/{userId}/notes/{noteId}` where `request.auth.uid == userId`.
  * **Firebase Storage:** Scoped to `users/{userId}/audio/{fileName}` with a 25MB limit and `audio/*` MIME enforcement.
  * **Vector Search:** All semantic and hybrid queries execute strictly within the authenticated user's `users/{userId}/notes` subcollection—preventing any cross-user data leakage.

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
* **PWA App Shortcuts:** Long-pressing the app icon offers **"Instant Voice Note"** (`/capture?mode=voice&autostart=1`) and **"Quick Text Capture"** (`/capture`).

### D. Multimodal Voice Capture (`VoiceRecorder`)
* Available from the Dashboard Omnibar, `/capture` page, or PWA shortcut.
* Acquires a screen WakeLock, displays a real-time Web Audio API frequency level meter, and flushes 1-second audio chunks to IndexedDB (`voice_drafts`) so recordings survive tab crashes or phone locks.
* Uploads audio to Firebase Storage (`users/{userId}/audio/`) and sends the audio to `/api/voice`, where Gemini produces:
  1. A concise 3–7 word **Title**.
  2. A 1–3 sentence **AI Summary**.
  3. A verbatim **Transcript**.
  4. Relevant **Tags** (including `#voice-memo`).

### E. Conversational RAG Search ("Search Your Brain")
* Users ask natural-language questions across their entire knowledge base.
* The system embeds the query (`768` dimensions), runs a hybrid retrieval pipeline (Firestore `findNearest` vector search + keyword/tag/title boosting), and synthesizes a structured answer via Gemini with explicit `[Note: Title]` citations and collapsible source cards showing match percentages.

