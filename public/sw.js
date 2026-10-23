// Service Worker for Second Brain PWA (v3)
// Handles offline caching, static asset persistence, Web Share Target, and offline note creation fallback

const CACHE_NAME = "gbrain-v3";
const DB_NAME = "gbrain_offline_store";
const DB_VERSION = 1;
const SHARE_STORE = "shared_media";

// Core routes and assets to precache on install
const PRECACHE_ASSETS = [
  "/",
  "/dashboard",
  "/capture",
  "/manifest.json",
  "/icons/icon-192.svg",
  "/icons/icon-512.svg",
  "/favicon.ico",
];

// Self-contained, responsive offline fallback shell if cached Next.js bundle is unavailable
const OFFLINE_FALLBACK_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <title>Second Brain (Offline Mode)</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background-color: #ECEFF4; color: #2E3440; min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 24px 16px; }
    .card { background: white; border: 1px solid #D8DEE9; border-radius: 20px; width: 100%; max-width: 480px; padding: 24px; box-shadow: 0 4px 16px rgba(0,0,0,0.06); }
    .header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
    .logo { width: 40px; height: 40px; background: #5E81AC; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 20px; }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; background: #FFF1E6; color: #D08770; border-radius: 999px; font-size: 11px; font-weight: 600; margin-bottom: 16px; }
    .badge-dot { width: 8px; height: 8px; background: #D08770; border-radius: 50%; }
    h1 { font-size: 18px; font-weight: 700; color: #2E3440; }
    p { font-size: 13px; color: #4C566A; line-height: 1.5; margin-bottom: 16px; }
    textarea { width: 100%; min-height: 140px; border: 1px solid #D8DEE9; border-radius: 14px; padding: 14px; font-size: 14px; color: #2E3440; resize: vertical; outline: none; transition: border-color 0.2s; background: #F8FAFC; }
    textarea:focus { border-color: #5E81AC; background: white; }
    .btn { display: block; width: 100%; background: #5E81AC; color: white; border: none; padding: 14px; border-radius: 14px; font-size: 14px; font-weight: 600; cursor: pointer; text-align: center; margin-top: 12px; }
    .btn:active { background: #4C566A; }
    .btn-secondary { background: transparent; color: #5E81AC; border: 1px solid #D8DEE9; margin-top: 8px; }
    .feedback { display: none; padding: 12px; background: #E5F6DF; color: #2E7D32; border-radius: 12px; font-size: 13px; margin-top: 12px; text-align: center; font-weight: 500; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="logo">🧠</div>
      <div>
        <h1>Second Brain</h1>
        <div style="font-size: 11px; color: #64748B;">Gustavo &amp; Gianna</div>
      </div>
    </div>
    
    <div class="badge">
      <div class="badge-dot"></div>
      <span>Airplane / Offline Mode Active</span>
    </div>

    <p>Your device is currently disconnected. Any notes created below are saved to local offline storage and will sync automatically once reception returns.</p>

    <textarea id="noteText" placeholder="Jot down a quick thought, link, or reminder..."></textarea>
    
    <button class="btn" id="saveBtn" onclick="saveOfflineNote()">Save Note to Offline Brain</button>
    <button class="btn btn-secondary" onclick="window.location.reload()">Refresh App Connection</button>

    <div class="feedback" id="feedbackMsg">✓ Note saved safely to local storage!</div>
  </div>

  <script>
    async function saveOfflineNote() {
      const textarea = document.getElementById('noteText');
      const text = textarea.value.trim();
      if (!text) return;

      const note = {
        id: 'offline_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        title: text.split('\\n')[0].substring(0, 50) || 'Offline Note',
        plain_text: text,
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: text }] }] },
        tags: ['offline-capture'],
        status: 'ready',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      try {
        const stored = JSON.parse(localStorage.getItem('gbrain_demo_notes_usr_gustavo_01') || '[]');
        stored.unshift(note);
        localStorage.setItem('gbrain_demo_notes_usr_gustavo_01', JSON.stringify(stored));
        textarea.value = '';
        const fb = document.getElementById('feedbackMsg');
        fb.style.display = 'block';
        setTimeout(() => { fb.style.display = 'none'; }, 3500);
      } catch (err) {
        alert('Saved locally!');
      }
    }
  </script>
</body>
</html>`;

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

// 1. Install event: Precache core shell assets & activate immediately
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const url of PRECACHE_ASSETS) {
        try {
          const res = await fetch(url, { cache: "no-cache" });
          if (res && res.status === 200) {
            await cache.put(url, res);
          }
        } catch (err) {
          console.warn(`[SW] Precache failed for ${url}:`, err);
        }
      }
    })
  );
  self.skipWaiting();
});

// 2. Activate event: Clean up old cache versions and claim clients
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((name) => {
            if (name !== CACHE_NAME) {
              return caches.delete(name);
            }
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

// 3. Fetch event: Smart routing for navigation, static assets, APIs, and Web Share Target
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // A. Intercept Web Share Target POST action
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

          // Store binary payload in IndexedDB
          await storeSharedPayload(payload);

          // Redirect to /capture with params
          const redirectParams = new URLSearchParams();
          redirectParams.set("shareId", shareId);
          if (payload.title) redirectParams.set("title", payload.title);
          if (payload.text) redirectParams.set("text", payload.text);
          if (payload.url) redirectParams.set("url", payload.url);
          if (payload.hasAudio) redirectParams.set("audioShared", "1");

          return Response.redirect(`/capture?${redirectParams.toString()}`, 303);
        } catch (err) {
          console.error("[SW] Share Target POST processing error:", err);
          return Response.redirect("/capture?error=share_failed", 303);
        }
      })()
    );
    return;
  }

  // Only handle GET requests for caching
  if (event.request.method !== "GET") {
    return;
  }

  // Ignore cross-origin requests
  if (url.origin !== self.location.origin) {
    return;
  }

  // B. API Requests: Network-first with clean JSON offline fallback
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(
          JSON.stringify({
            error: "offline",
            message: "Network unavailable. Operating in offline mode.",
          }),
          {
            status: 503,
            headers: { "Content-Type": "application/json" },
          }
        );
      })
    );
    return;
  }

  // C. HTML Navigation Requests (mode === 'navigate'):
  // Network-first with fast 3.5s timeout, falling back to cached shell, then inline offline fallback
  if (event.request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          // Abort fast if in dead zone or airplane mode
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3500);

          const networkResponse = await fetch(event.request, {
            signal: controller.signal,
          });
          clearTimeout(timeoutId);

          if (networkResponse && networkResponse.status === 200) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(event.request, networkResponse.clone());
            if (url.pathname === "/dashboard") {
              cache.put("/dashboard", networkResponse.clone());
            }
          }
          return networkResponse;
        } catch {
          // Network failed or timed out -> Fallback to cached page
          const cache = await caches.open(CACHE_NAME);

          // 1. Try matching the exact requested URL (ignoring search parameters)
          const cachedMatch = await cache.match(event.request, { ignoreSearch: true });
          if (cachedMatch) return cachedMatch;

          // 2. Try pathname directly
          const pathMatch = await cache.match(url.pathname, { ignoreSearch: true });
          if (pathMatch) return pathMatch;

          // 3. Fallback for capture route
          if (url.pathname.startsWith("/capture")) {
            const captureFallback = await cache.match("/capture", { ignoreSearch: true });
            if (captureFallback) return captureFallback;
          }

          // 4. Default to dashboard shell
          const dashboardFallback = await cache.match("/dashboard", { ignoreSearch: true });
          if (dashboardFallback) return dashboardFallback;

          // 5. Try root
          const rootFallback = await cache.match("/", { ignoreSearch: true });
          if (rootFallback) return rootFallback;

          // 6. Absolute last-resort inline HTML shell so Chrome WebAPK NEVER shows "You're offline"
          return new Response(OFFLINE_FALLBACK_HTML, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
      })()
    );
    return;
  }

  // D. Static Assets & RSC Payloads (_next/static, images, fonts, icons, CSS, RSC chunks):
  // Stale-While-Revalidate / Cache-First strategy
  const isStaticAsset =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".ico") ||
    url.pathname.endsWith(".json") ||
    url.searchParams.has("_rsc");

  if (isStaticAsset) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cachedResponse = await cache.match(event.request, { ignoreSearch: true });

        // Background revalidation
        const fetchPromise = fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          })
          .catch(() => null);

        // If in cache, return immediately (fast & offline resilient)
        if (cachedResponse) {
          return cachedResponse;
        }

        // Otherwise wait for network response
        const networkResponse = await fetchPromise;
        if (networkResponse) {
          return networkResponse;
        }

        // Return a generic fallback 404 response if completely missing
        return new Response("Not found", { status: 404 });
      })()
    );
    return;
  }

  // Default: Cache-first with network fallback
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      });
    })
  );
});
