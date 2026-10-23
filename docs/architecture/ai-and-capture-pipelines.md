# AI, RAG Search & Capture Pipelines

This document details the three core intelligence and ingestion pipelines in `gBrain`:
1. **Vector Embedding Pipeline (`/api/embed`)**
2. **Hybrid Vector Search & Conversational RAG Pipeline (`/api/search`, `/api/rag`, `/api/chat`)**
3. **Universal Share Target & Multimodal Voice Pipeline (`/capture-share-target`, `/capture`, `/api/voice`)**

---

## 1. Vector Embedding Pipeline (`POST /api/embed`)

### Trigger Points
* **Client Auto-Save:** [`saveNote()`](file:///Users/gustavo/dev/projects/gBrain/src/lib/notes/notes-service.ts#L155-L194) checks if `plain_text` is non-empty and changed since the last save (`previousPlainText !== note.plain_text || !note.embedding`). If so, it fires a non-blocking `POST /api/embed`.
* **Voice Memo Creation:** [`POST /api/voice`](file:///Users/gustavo/dev/projects/gBrain/src/app/api/voice/route.ts#L78-L79) synchronously embeds the combined title + summary + transcript before writing the voice note.
* **Google Keep Seeding:** [`POST /api/seed`](file:///Users/gustavo/dev/projects/gBrain/src/app/api/seed/route.ts#L198-L204) embeds imported notes in batches of 5.

### Multi-Tier Embedding Strategy ([`generateTextEmbedding`](file:///Users/gustavo/dev/projects/gBrain/src/lib/firebase/admin.ts#L202-L267))
To ensure reliability across Cloud Run (ADC), API-key environments, and offline local testing, `generateTextEmbedding` sanitizes input text (`sanitizeTextForGemini`, max 20,000 chars) and attempts:
1. **Tier 1 (Direct Gemini REST API):** If `GEMINI_API_KEY` or `GOOGLE_API_KEY` is set, calls `models/gemini-embedding-001:embedContent` with `outputDimensionality: 768`.
2. **Tier 2 (Vertex AI ADC):** Uses `getVertexAIGenAIClient()` (`@google/genai` with `vertexai: true`, location `us-central1`) to call `text-embedding-004` (natively 768 dimensions).
3. **Tier 3 (Deterministic Mock Fallback):** If GCP credentials or network are unavailable in local dev, [`generateDeterministicMockEmbedding`](file:///Users/gustavo/dev/projects/gBrain/src/lib/firebase/admin.ts#L184-L197) produces a normalized 768-dimensional float vector so vector math and local flows never crash.

### Firestore Persistence
* [`src/app/api/embed/route.ts`](file:///Users/gustavo/dev/projects/gBrain/src/app/api/embed/route.ts#L47-L65) writes `embedding: FieldValue.vector(embedding)` (falling back to a raw `number[]` array if the SDK version or emulator rejects `VectorValue`), along with `hasEmbedding: true` and `embeddingUpdatedAt`.

---

## 2. Hybrid Vector Search & RAG Pipeline (`POST /api/search`)

> **Note:** [`/api/rag/route.ts`](file:///Users/gustavo/dev/projects/gBrain/src/app/api/rag/route.ts) and [`/api/chat/route.ts`](file:///Users/gustavo/dev/projects/gBrain/src/app/api/chat/route.ts) directly re-export `POST` from [`/api/search/route.ts`](file:///Users/gustavo/dev/projects/gBrain/src/app/api/search/route.ts).

```mermaid
sequenceDiagram
    participant User as ConversationalSearch UI
    participant SearchAPI as POST /api/search
    participant Embed as generateTextEmbedding
    participant FS as Firestore (users/{uid}/notes)
    participant Gemini as generateRAGAnswer (Gemini Flash)

    User->>SearchAPI: { query, userId, localNotes }
    SearchAPI->>Embed: Embed query (768-dim)
    Embed-->>SearchAPI: queryEmbedding[]
    SearchAPI->>FS: findNearest(vectorField: "embedding", limit: 30, COSINE)
    alt Vector Index Active & Returns Docs
        FS-->>SearchAPI: Top 30 semantic matches + distance
    else Vector Index Building / Empty / Offline
        SearchAPI->>FS: Fallback: orderBy("updatedAt", "desc").limit(250)
        FS-->>SearchAPI: Up to 250 candidate notes (or client localNotes)
    end
    SearchAPI->>SearchAPI: Filter noise (isQualityNote) & compute Hybrid Score (Cosine + Tag +0.15 + Title +0.10)
    SearchAPI->>Gemini: Top 30 ranked notes + System Instruction
    Gemini-->>SearchAPI: Grounded answer with [Note: Title] citations
    SearchAPI-->>User: { answer, sources, usedVectorSearch, totalMatches }
```

### Key Pipeline Rules (Core Architectural Rule 2)
1. **No Database Pre-Filtering:** `findNearest` is never combined with `.where()` tag or date filters in Firestore to avoid rigid composite vector index requirements.
2. **Quality Filtering (`isQualityNote`):** Filters out stub notes shorter than 15 characters or legacy placeholder notes containing `"Full multimodal transcription deferred"`.
3. **Hybrid Re-Ranking:**
   * **Base Score:** `1 - cosineDistance` (from `findNearest`) or computed in-memory via `cosineSimilarity(queryEmbedding, note.embedding)` (or keyword frequency fallback if unembedded).
   * **Tag Boost (`+0.15`):** Applied when any non-stopword in the user's query matches one of the note's `#tags`.
   * **Title Boost (`+0.10`):** Applied when any query keyword appears in the note's title.
4. **Grounded Synthesis (`generateRAGAnswer`):**
   * Formats the top 30 ranked notes as `[Note i: Title]\nPlain Text` blocks.
   * Instructs Gemini to group insights conceptually, ground all claims strictly in the provided notes, and cite every claim with `[Note: Title]`.
   * Tries Direct REST (`GEMINI_API_KEY`) → Vertex AI ADC (`CANDIDATE_GEMINI_MODELS`) → AI Studio SDK. Throws a `SynthesisError` rather than returning a fake template if all models fail.

---

## 3. Universal Capture & Multimodal Voice Pipeline

```mermaid
sequenceDiagram
    autonumber
    actor User as User (Mobile / Desktop)
    participant UI as VoiceRecorder / /capture
    participant FS as Firestore (users/{uid}/notes)
    participant Storage as Firebase Storage (audio/)
    participant API as Voice Backend (/api/voice)
    participant Gemini as Gemini 1.5 Flash & Vertex AI

    User->>UI: Tap "Stop Recording"
    UI->>FS: ⚡ 1. Save Placeholder Note (status: "processing", audioUrl)
    UI-->>User: ⚡ 2. Instant Haptic Buzz & Dismiss Modal (< 500ms)
    
    Note over User,UI: User is back on Dashboard or phone is locked!

    par Decoupled Background Thread
        UI->>Storage: Upload audio file
        UI->>FS: Update Note with storage audioUrl
        UI-)API: POST /api/voice (keepalive: true)
        API->>Gemini: Multimodal Analysis (Title, Summary, Transcript, Tags)
        Gemini-->>API: Structured JSON Output
        API->>Gemini: Generate 768-dim Text Embedding
        Gemini-->>API: Float vector[768]
        API->>FS: Update Note (status: "ready", content, summary, tags, embedding)
    end

    FS-->>UI: Real-time onSnapshot event
    Note over UI: Card smoothly transitions from "Synthesizing..." to ready!
```

### A. Sub-500ms Optimistic Capture Architecture
To eliminate mobile friction (where users previously waited 10–15s for Gemini synthesis while holding the screen on):
1. **Immediate Local Stash:** When recording stops, [`VoiceRecorder.tsx`](file:///Users/gustavo/dev/projects/gBrain/src/components/voice/VoiceRecorder.tsx) creates a local `Blob` URL and instantly saves a placeholder `Note` document with `status: "processing"`.
2. **Instant UI Release:** The recording modal is dismissed in **< 500ms** with haptic feedback, returning the user to their dashboard immediately.
3. **Audio Playback:** The placeholder card on the dashboard renders the HTML5 audio player immediately, allowing users to listen to their voice memo while synthesis runs.
4. **Decoupled Background Dispatch:** In a non-blocking background thread (`keepalive: true`), the audio is uploaded to Firebase Storage and dispatched to `POST /api/voice`.
5. **Real-Time In-Place Update:** When `POST /api/voice` completes, it updates the document in `users/{userId}/notes/{noteId}` to `status: "ready"`. The client's Firestore `onSnapshot` listener automatically transforms the card from its skeleton state to the fully titled, summarized, and tagged note without requiring a page reload.
6. **Fault Tolerance:** If synthesis fails, the document updates to `status: "failed"` with `processingError`, preserving the raw audio and showing a 1-tap "Retry" button.

### B. Web Share Target Flow
1. [`public/manifest.json`](file:///Users/gustavo/dev/projects/gBrain/public/manifest.json#L24-L39) registers `/capture-share-target` (`POST`, `multipart/form-data`) accepting `title`, `text`, `url`, and `audio` files (`audio/*`, `.m4a`, `.mp3`, `.wav`, `.aac`, `.webm`, `.ogg`).
2. [`public/sw.js`](file:///Users/gustavo/dev/projects/gBrain/public/sw.js#L55-L99) intercepts the `POST`, writes the payload (including any binary `audioBlob`) to IndexedDB (`shared_media`), and issues a `303 See Other` redirect to `/capture?shareId=...&audioShared=1`.
3. If an audio file was shared (e.g., from Pixel Recorder), [`/capture/page.tsx`](file:///Users/gustavo/dev/projects/gBrain/src/app/capture/page.tsx) immediately saves a placeholder note with `status: "processing"`, confirms to the user, and triggers background synthesis without blocking the UI.
4. If only a link or text was shared, `/capture/page.tsx` immediately saves the note upon verifying the user's session, then offers a 1-tap **"Add Spoken Thought to this Note"** button.
5. If the user records a spoken thought for that shared link, `VoiceRecorder` passes `targetNoteId={savedNote.id}` and `sharedContext={{ title, url, text }}` to `/api/voice`, updating the quick-captured link note with rich multimodal intelligence.

### C. Multimodal Voice Processing (`processMultimodalVoiceMemo`)
Implemented in [`src/lib/firebase/admin.ts`](file:///Users/gustavo/dev/projects/gBrain/src/lib/firebase/admin.ts#L473-L674):
1. Normalizes browser MIME strings (e.g., stripping `;codecs=opus` via `normalizeAudioMimeType`) and extracts clean base64 data.
2. Sends the audio inline (`inlineData`) along with any `sharedContext` (referenced URL/title/snippet) to Gemini (`responseMimeType: "application/json"`, `temperature: 0.2`).
3. Requests a strict JSON schema: `{ title, summary, transcript, tags }`.
4. Fallback chain:
   * **Strategy 1:** `@google/genai` client across `CANDIDATE_GEMINI_MODELS`.
   * **Strategy 2:** `@google-cloud/vertexai` SDK (`gemini-2.5-flash`, `gemini-1.5-flash`, `gemini-2.0-flash-001`).
   * **Strategy 3:** Browser `SpeechRecognition` transcript synthesis or timezone-aware (`America/Los_Angeles`) timestamped fallback so a user's recording is never lost.

### D. Offline Resilience & Service Worker Caching
Implemented to guarantee full offline functionality in network dead zones:
1. **Service Worker Pre-caching & Routing ([`public/sw.js`](file:///Users/gustavo/dev/projects/gBrain/public/sw.js)):**
   * **Pre-caching on Install:** Core application shells (`/dashboard`, `/capture`), manifest (`/manifest.json`), and SVG icons are cached immediately on install with `self.skipWaiting()`.
   * **Cache Cleanup on Activate:** Old cache versions (`gbrain-v1`) are deleted and active clients claimed.
   * **Navigation Routing (`mode === "navigate"`):** Network-first with automatic cache fallback. If no internet reception is available, the cached dashboard/capture shell is returned seamlessly, completely preventing native browser offline dinosaur/error screens.
   * **Static Asset & RSC Strategy:** Stale-While-Revalidate / Cache-First for Next.js chunks (`/_next/static/`), CSS, TipTap editor bundles, SVGs, and RSC payloads.
   * **API Call Fallback:** Network-first with structured 503 JSON responses (`{ error: "offline" }`) for backend `/api/*` endpoints.
2. **Offline Note Persistence:**
   * Text notes and edits are saved directly to Firestore's client-side [`persistentLocalCache`](file:///Users/gustavo/dev/projects/gBrain/src/lib/firebase/client.ts#L52-L56) (`persistentMultipleTabManager`), queuing automatic synchronization to GCP once reception is restored.
3. **Offline Voice Memo Queue:**
   * In [`VoiceRecorder.tsx`](file:///Users/gustavo/dev/projects/gBrain/src/components/voice/VoiceRecorder.tsx), if audio is recorded without reception, the audio chunks remain safely stashed in IndexedDB (`voice_drafts`) and the note is marked with `status: "queued"`.
   * The dashboard displays an `⏳ Offline` badge with a 1-tap manual sync button, and automatically triggers background synthesis via `window.addEventListener("online")` as soon as internet connectivity returns.
4. **Visual Connection State Feedback:**
   * [`src/components/pwa/OfflineIndicator.tsx`](file:///Users/gustavo/dev/projects/gBrain/src/components/pwa/OfflineIndicator.tsx) uses `useSyncExternalStore` to track `navigator.onLine`, presenting a non-intrusive status pill when offline and confirming with a green *"Back Online • Synced"* indicator upon reconnection.


