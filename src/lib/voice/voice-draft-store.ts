// IndexedDB Storage Layer for crash-safe voice recording & shared media retrieval

const DB_NAME = "gbrain_offline_store";
const DB_VERSION = 1;
const SHARE_STORE = "shared_media";
const DRAFTS_STORE = "voice_drafts";

export interface SharedMediaPayload {
  id: string;
  title: string;
  text: string;
  url: string;
  hasAudio: boolean;
  audioBlob: Blob | null;
  audioName: string;
  audioType: string;
  timestamp: number;
}

export interface VoiceDraft {
  id: string;
  userId: string;
  chunks: Blob[];
  mimeType: string;
  extension: string;
  startedAt: number;
  durationSeconds: number;
  status: "recording" | "completed" | "interrupted" | "syncing" | "synced" | "failed";
  targetNoteId?: string; // If appending to an existing note (e.g. shared link)
  sharedContext?: {
    title?: string;
    text?: string;
    url?: string;
  };
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !("indexedDB" in window)) {
      return reject(new Error("IndexedDB is not available in this environment"));
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(SHARE_STORE)) {
        db.createObjectStore(SHARE_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(DRAFTS_STORE)) {
        db.createObjectStore(DRAFTS_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Retrieves a shared payload deposited by the Service Worker (e.g., audio from Pixel Recorder)
 */
export async function getSharedMediaPayload(shareId: string): Promise<SharedMediaPayload | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SHARE_STORE, "readonly");
      const store = tx.objectStore(SHARE_STORE);
      const req = store.get(shareId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error("[VoiceStore] Failed to get shared payload:", err);
    return null;
  }
}

/**
 * Removes a shared payload once processed
 */
export async function deleteSharedMediaPayload(shareId: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(SHARE_STORE, "readwrite");
    tx.objectStore(SHARE_STORE).delete(shareId);
  } catch (err) {
    console.error("[VoiceStore] Failed to delete shared payload:", err);
  }
}

/**
 * Initializes or updates an active voice recording session
 */
export async function saveVoiceDraft(draft: VoiceDraft): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DRAFTS_STORE, "readwrite");
      const store = tx.objectStore(DRAFTS_STORE);
      const req = store.put(draft);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error("[VoiceStore] Failed to save draft:", err);
  }
}

/**
 * Appends an audio chunk directly to IndexedDB to survive tab crashes, phone calls, or screen locking
 */
export async function appendDraftChunk(draftId: string, chunk: Blob, durationSeconds: number): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DRAFTS_STORE, "readwrite");
      const store = tx.objectStore(DRAFTS_STORE);
      const getReq = store.get(draftId);

      getReq.onsuccess = () => {
        const draft: VoiceDraft = getReq.result;
        if (draft) {
          draft.chunks.push(chunk);
          draft.durationSeconds = durationSeconds;
          store.put(draft);
        }
        resolve();
      };
      getReq.onerror = () => reject(getReq.error);
    });
  } catch (err) {
    console.warn("[VoiceStore] Failed to append chunk to IndexedDB:", err);
  }
}

/**
 * Retrieves a draft by ID
 */
export async function getVoiceDraft(draftId: string): Promise<VoiceDraft | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DRAFTS_STORE, "readonly");
      const store = tx.objectStore(DRAFTS_STORE);
      const req = store.get(draftId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error("[VoiceStore] Failed to get draft:", err);
    return null;
  }
}

/**
 * Lists any interrupted or un-synced voice drafts (for recovery on next app launch)
 */
export async function getPendingVoiceDrafts(): Promise<VoiceDraft[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DRAFTS_STORE, "readonly");
      const store = tx.objectStore(DRAFTS_STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        const drafts: VoiceDraft[] = req.result || [];
        // Only return drafts that need syncing
        resolve(drafts.filter((d) => d.status === "interrupted" || d.status === "completed"));
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error("[VoiceStore] Failed to get pending drafts:", err);
    return [];
  }
}

/**
 * Deletes a draft once successfully uploaded and processed by Gemini
 */
export async function deleteVoiceDraft(draftId: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(DRAFTS_STORE, "readwrite");
    tx.objectStore(DRAFTS_STORE).delete(draftId);
  } catch (err) {
    console.error("[VoiceStore] Failed to delete draft:", err);
  }
}

