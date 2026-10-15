"use client";

import React from "react";
import { useAuth } from "@/context/AuthContext";

export default function Phase1Dashboard() {
  const { user, signOut } = useAuth();

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* Navbar header */}
      <div className="navbar bg-base-200/60 backdrop-blur rounded-2xl border border-base-300 shadow-sm px-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-bold">
              🧠
            </div>
            <span className="font-bold text-lg">Second Brain</span>
            <span className="badge badge-success badge-sm">Phase 1 Ready</span>
          </div>
        </div>
        <div className="flex-none gap-2">
          <div className="text-right mr-2 hidden sm:block">
            <div className="text-xs font-semibold">{user?.displayName || user?.email}</div>
            <div className="text-[10px] text-base-content/50 font-mono">
              UID: {user?.uid.slice(0, 12)}...
            </div>
          </div>
          <button
            onClick={() => signOut()}
            className="btn btn-outline btn-sm btn-error"
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* Hero Welcome */}
      <div className="card bg-base-200/40 border border-base-300 shadow-lg p-6 sm:p-8">
        <div className="max-w-2xl">
          <h2 className="text-2xl font-bold tracking-tight mb-2">
            Welcome back, {user?.displayName || user?.email?.split("@")[0]}! 👋
          </h2>
          <p className="text-sm text-base-content/70 leading-relaxed mb-6">
            Your Second Brain environment is authenticated and connected.
            Data isolation is strictly enforced at the Firestore subcollection level.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Subcollection Scope Card */}
            <div className="p-4 rounded-xl bg-base-100/60 border border-base-300">
              <div className="text-xs font-semibold text-primary uppercase tracking-wider mb-1">
                Firestore Subcollection Path
              </div>
              <div className="font-mono text-xs bg-base-300/60 px-3 py-2 rounded-lg text-base-content/90 break-all select-all">
                users/{user?.uid}/notes
              </div>
              <p className="text-[11px] text-base-content/50 mt-2">
                Vector queries and note mutations will be strictly scoped to this path.
              </p>
            </div>

            {/* Architecture Card */}
            <div className="p-4 rounded-xl bg-base-100/60 border border-base-300">
              <div className="text-xs font-semibold text-secondary uppercase tracking-wider mb-1">
                Security & ADC Status
              </div>
              <div className="text-xs font-mono text-success flex items-center gap-1.5 pt-1">
                <span className="inline-block w-2 h-2 rounded-full bg-success animate-pulse"></span>
                Security Rules Enforced
              </div>
              <p className="text-[11px] text-base-content/50 mt-2">
                Server-side modules configured with Application Default Credentials (ADC).
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Phase Roadmap Progress */}
      <div className="card bg-base-200/30 border border-base-300 p-6">
        <h3 className="text-sm font-bold uppercase tracking-wider text-base-content/60 mb-4">
          Development Roadmap
        </h3>
        <ul className="steps steps-vertical sm:steps-horizontal w-full text-xs">
          <li className="step step-primary">
            Phase 1: Next.js, Auth & ADC
          </li>
          <li className="step">
            Phase 2: TipTap Editor & Dashboard
          </li>
          <li className="step">
            Phase 3: PWA & Universal Capture
          </li>
          <li className="step">
            Phase 4: Vertex AI & Vector RAG
          </li>
        </ul>
      </div>
    </div>
  );
}

