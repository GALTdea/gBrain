// Service Worker for Second Brain PWA
// Handles offline caching, static asset persistence, and intercepts Web Share Target POST requests

const CACHE_NAME = "gbrain-v2";
const DB_NAME = "gbrain_offline_store";
const DB_VERSION = 1;
const SHARE_STORE = "shared_media";

// Core routes and assets to precache on install
const PRECACHE_ASSETS = [
  "/dashboard",
  "/capture",
  "/manifest.json",
  "/icons/icon-192.svg",
  "/icons/icon-512.svg",
  "/favicon.ico",
];

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
      // Use individual caching so failure of one route doesn't abort the entire install
      await Promise.allSettled(
        PRECACHE_ASSETS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn(`[SW] Precache failed for ${url}:`, err);
          })
        )
      );
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

  // Ignore cross-origin requests (e.g. Firebase Auth, Firestore, Google APIs)
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

  // C. HTML Navigation Requests (mode === 'navigate'): Network-first falling back to cached shell
  if (event.request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse && networkResponse.status === 200) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        } catch (networkError) {
          // Network failed (offline / dead zone) -> Fallback to cached page
          const cache = await caches.open(CACHE_NAME);
          const cachedMatch = await cache.match(event.request);
          if (cachedMatch) {
            return cachedMatch;
          }

          // If navigating to an uncached route while offline, fallback to /dashboard or /capture
          if (url.pathname.startsWith("/capture")) {
            const captureFallback = await cache.match("/capture");
            if (captureFallback) return captureFallback;
          }

          const dashboardFallback = await cache.match("/dashboard");
          if (dashboardFallback) return dashboardFallback;

          throw networkError;
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
        const cachedResponse = await cache.match(event.request);

        // Fetch from network to update cache in background
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

  // Default: Network with cache fallback
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
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
