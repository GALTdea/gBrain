"use client";

import React from "react";
import { useAuth } from "@/context/AuthContext";

export default function Phase1Dashboard() {
  const { user, signOut } = useAuth();

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* Navbar header */}
      <div className="navbar bg-white border border-[#D8DEE9] shadow-sm rounded-2xl px-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#E5E9F0] text-[#5E81AC] flex items-center justify-center font-bold">
              🧠
            </div>
            <span className="font-bold text-lg text-[#2E3440]">Second Brain</span>
            <span className="badge bg-emerald-50 text-emerald-700 ring-1 ring-emerald-700/10 border-none badge-sm font-semibold">Phase 1 Ready</span>
          </div>
        </div>
        <div className="flex-none gap-2">
          <div className="text-right mr-2 hidden sm:block">
            <div className="text-xs font-semibold text-[#2E3440]">{user?.displayName || user?.email}</div>
            <div className="text-[10px] text-[#64748B] font-mono">
              UID: {user?.uid.slice(0, 12)}...
            </div>
          </div>
          <button
            onClick={() => signOut()}
            className="btn btn-ghost btn-sm text-xs text-[#64748B] hover:bg-rose-50 hover:text-rose-700"
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* Hero Welcome */}
      <div className="card bg-white border border-[#D8DEE9] shadow-md p-6 sm:p-8 rounded-2xl">
        <div className="max-w-2xl">
          <h2 className="text-2xl font-bold tracking-tight text-[#2E3440] mb-2">
            Welcome back, {user?.displayName || user?.email?.split("@")[0]}! 👋
          </h2>
          <p className="text-sm text-[#4C566A] leading-relaxed mb-6">
            Your Second Brain environment is authenticated and connected.
            Data isolation is strictly enforced at the Firestore subcollection level.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Subcollection Scope Card */}
            <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#D8DEE9]">
              <div className="text-xs font-semibold text-[#5E81AC] uppercase tracking-wider mb-1">
                Firestore Subcollection Path
              </div>
              <div className="font-mono text-xs bg-[#E5E9F0] px-3 py-2 rounded-lg text-[#2E3440] break-all select-all">
                users/{user?.uid}/notes
              </div>
              <p className="text-[11px] text-[#64748B] mt-2">
                Vector queries and note mutations will be strictly scoped to this path.
              </p>
            </div>

            {/* Architecture Card */}
            <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#D8DEE9]">
              <div className="text-xs font-semibold text-[#88C0D0] uppercase tracking-wider mb-1">
                Security & ADC Status
              </div>
              <div className="text-xs font-mono text-emerald-600 flex items-center gap-1.5 pt-1">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                Security Rules Enforced
              </div>
              <p className="text-[11px] text-[#64748B] mt-2">
                Server-side modules configured with Application Default Credentials (ADC).
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Phase Roadmap Progress */}
      <div className="card bg-white border border-[#D8DEE9] p-6 rounded-2xl shadow-sm">
        <h3 className="text-sm font-bold uppercase tracking-wider text-[#64748B] mb-4">
          Development Roadmap
        </h3>
        <ul className="steps steps-vertical sm:steps-horizontal w-full text-xs text-[#2E3440]">
          <li className="step step-primary text-[#5E81AC] font-semibold">
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

