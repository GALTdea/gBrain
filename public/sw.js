// Service Worker for Second Brain PWA
// Handles caching and intercepts Web Share Target POST requests (Audio files & text)

const CACHE_NAME = "gbrain-v1";
const DB_NAME = "gbrain_offline_store";
const DB_VERSION = 1;
const SHARE_STORE = "shared_media";

// Open or initialize IndexedDB for passing files from Service Worker to App
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(SHARE_STORE)) {
        db.createObjectStore(SHARE_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("voice_drafts")) {
        db.createObjectStore("voice_drafts", { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeSharedPayload(data) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SHARE_STORE, "readwrite");
      const store = tx.objectStore(SHARE_STORE);
      const req = store.put(data);
      req.onsuccess = () => resolve(data.id);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error("[SW] Error writing to IndexedDB:", err);
    return null;
  }
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Intercept the Web Share Target POST action
  if (event.request.method === "POST" && url.pathname === "/capture-share-target") {
    event.respondWith(
      (async () => {
        try {
          const formData = await event.request.formData();
          const title = formData.get("title") || "";
          const text = formData.get("text") || "";
          const sharedUrl = formData.get("url") || "";
          const audioFile = formData.get("audio");

          const shareId = `share_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

          const payload = {
            id: shareId,
            title: typeof title === "string" ? title : "",
            text: typeof text === "string" ? text : "",
            url: typeof sharedUrl === "string" ? sharedUrl : "",
            hasAudio: Boolean(audioFile && audioFile.size > 0),
            audioBlob: audioFile && audioFile.size > 0 ? audioFile : null,
            audioName: audioFile?.name || "recording.m4a",
            audioType: audioFile?.type || "audio/m4a",
            timestamp: Date.now(),
          };

          // Store the binary payload in IndexedDB so the client page can read it safely
          await storeSharedPayload(payload);

          // Construct redirect URL to the client capture page
          const redirectParams = new URLSearchParams();
          redirectParams.set("shareId", shareId);
          if (payload.title) redirectParams.set("title", payload.title);
          if (payload.text) redirectParams.set("text", payload.text);
          if (payload.url) redirectParams.set("url", payload.url);
          if (payload.hasAudio) redirectParams.set("audioShared", "1");

          // 303 See Other redirect to /capture with query params
          return Response.redirect(`/capture?${redirectParams.toString()}`, 303);
        } catch (err) {
          console.error("[SW] Share Target POST processing error:", err);
          // Fallback: redirect cleanly to /capture
          return Response.redirect("/capture?error=share_failed", 303);
        }
      })()
    );
  }
});

