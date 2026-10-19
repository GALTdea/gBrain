"use client";

import { useEffect } from "react";

/**
 * Registers the Service Worker (public/sw.js) on client mount
 * Enables Web Share Target POST handling and offline caching capabilities.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker
          .register("/sw.js")
          .then((registration) => {
            // Check for updates
            registration.update().catch(() => {});
          })
          .catch((err) => {
            console.warn("[PWA] Service Worker registration failed:", err);
          });
      });
    }
  }, []);

  return null;
}

