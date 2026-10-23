"use client";

import React, { useState, useEffect, useSyncExternalStore } from "react";

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getSnapshot() {
  return navigator.onLine;
}

function getServerSnapshot() {
  return true;
}

/**
 * OfflineIndicator displays a non-intrusive status pill when internet reception
 * is lost, reassuring the user that notes are safely saved in Firestore offline cache.
 */
export default function OfflineIndicator() {
  const isOnline = useSyncExternalStore(subscribeOnline, getSnapshot, getServerSnapshot);
  const isOffline = !isOnline;
  const [justReconnected, setJustReconnected] = useState<boolean>(false);

  useEffect(() => {
    if (isOnline) {
      const handleReconnected = () => {
        setJustReconnected(true);
        const timer = setTimeout(() => {
          setJustReconnected(false);
        }, 3500);
        return () => clearTimeout(timer);
      };

      window.addEventListener("online", handleReconnected);
      return () => window.removeEventListener("online", handleReconnected);
    }
  }, [isOnline]);

  if (!isOffline && !justReconnected) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 pointer-events-none transition-all duration-300 animate-in fade-in slide-in-from-bottom-2"
    >
      {isOffline ? (
        <div className="flex items-center gap-2.5 px-4 py-2 rounded-full bg-[#2E3440] text-[#ECEFF4] border border-[#4C566A] shadow-xl text-xs font-medium backdrop-blur-md">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#D08770] opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#D08770]"></span>
          </span>
          <span className="text-[#E5E9F0]">
            Offline Mode <span className="text-[#D8DEE9]/70">• Edits saved locally</span>
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-[#A3BE8C] text-[#2E3440] border border-[#8FBCBB] shadow-xl text-xs font-semibold backdrop-blur-md">
          <svg
            className="w-3.5 h-3.5 text-[#2E3440]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span>Back Online • Synced</span>
        </div>
      )}
    </div>
  );
}

