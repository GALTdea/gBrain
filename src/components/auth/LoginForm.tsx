"use client";

import React, { useState } from "react";
import { useAuth } from "@/context/AuthContext";

export default function LoginForm() {
  const {
    signInWithEmail,
    signInWithGoogle,
    loginAsDemoUser,
    error,
    clearError,
    isConfigured,
  } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    clearError();

    if (!email || !password) {
      setFormError("Please enter both email and password.");
      return;
    }

    try {
      setSubmitting(true);
      await signInWithEmail(email, password);
    } catch {
      // Error is caught and stored in AuthContext
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setFormError(null);
    clearError();
    try {
      setSubmitting(true);
      await signInWithGoogle();
    } catch {
      // Handled in context
    } finally {
      setSubmitting(false);
    }
  };

  const activeError = formError || error;

  return (
    <div className="w-full max-w-md mx-auto">
      {/* Brand Header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#E5E9F0] text-[#5E81AC] mb-4 ring-1 ring-[#D8DEE9] shadow-sm">
          <svg
            className="w-8 h-8"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
            />
          </svg>
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-[#2E3440]">
          Second Brain
        </h1>
        <p className="text-sm text-[#64748B] mt-1">
          Private Knowledge Base for Gustavo & Gianna
        </p>
      </div>

      {/* Main Card */}
      <div className="bg-white border border-[#D8DEE9] shadow-md rounded-2xl">
        <div className="card-body p-6 sm:p-8">
          {/* Active Error Alert */}
          {activeError && (
            <div className="alert bg-rose-50 border border-rose-200 text-rose-700 text-sm py-2 mb-4 rounded-xl flex items-center justify-between">
              <span>{activeError}</span>
              <button
                type="button"
                className="btn btn-ghost btn-xs btn-circle text-rose-700"
                onClick={() => {
                  setFormError(null);
                  clearError();
                }}
              >
                ✕
              </button>
            </div>
          )}

          {/* Config Missing Notice */}
          {!isConfigured && (
            <div className="alert bg-blue-50 border border-blue-200 text-[#5E81AC] text-xs py-2 mb-4 rounded-xl">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                className="stroke-current shrink-0 w-4 h-4"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span>
                Firebase config not yet initialized in <code>.env.local</code>. Use demo access below or connect your Firebase project.
              </span>
            </div>
          )}

          {/* Google Sign-In */}
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={submitting || !isConfigured}
            className="btn btn-outline border-[#D8DEE9] hover:bg-[#F8FAFC] hover:border-[#CBD5E1] text-[#2E3440] w-full flex items-center justify-center gap-3 font-medium transition-all rounded-xl"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            Continue with Google
          </button>

          <div className="divider text-xs text-[#94A3B8] my-4 uppercase tracking-wider font-semibold before:bg-[#D8DEE9] after:bg-[#D8DEE9]">
            or sign in with email
          </div>

          {/* Email / Password Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="form-control">
              <label className="label py-1">
                <span className="label-text text-xs font-semibold uppercase tracking-wider text-[#2E3440]">
                  Email
                </span>
              </label>
              <input
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#D8DEE9] bg-white text-sm text-[#2E3440] placeholder-[#94A3B8] focus:border-[#5E81AC] outline-none transition-all"
                required
              />
            </div>

            <div className="form-control">
              <label className="label py-1">
                <span className="label-text text-xs font-semibold uppercase tracking-wider text-[#2E3440]">
                  Password
                </span>
              </label>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#D8DEE9] bg-white text-sm text-[#2E3440] placeholder-[#94A3B8] focus:border-[#5E81AC] outline-none transition-all"
                required
              />
            </div>

            <button
              type="submit"
              disabled={submitting || !isConfigured}
              className="btn bg-[#5E81AC] hover:bg-[#81A1C1] text-white border-none w-full mt-2 font-semibold shadow rounded-xl"
            >
              {submitting ? (
                <span className="loading loading-spinner loading-sm text-white"></span>
              ) : (
                "Sign In"
              )}
            </button>
          </form>

          {/* Demo Fallback Switcher (when configuring or previewing offline) */}
          <div className="mt-6 pt-4 border-t border-[#D8DEE9]">
            <div className="text-xs text-center text-[#64748B] mb-3">
              Developer Demo Switcher (Simulate Session)
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => loginAsDemoUser("gustavo")}
                className="btn btn-xs btn-outline border-[#D8DEE9] text-[#2E3440] hover:border-[#CBD5E1] hover:bg-[#E5E9F0]"
              >
                Gustavo (Account 1)
              </button>
              <button
                type="button"
                onClick={() => loginAsDemoUser("gianna")}
                className="btn btn-xs btn-outline border-[#D8DEE9] text-[#2E3440] hover:border-[#CBD5E1] hover:bg-[#E5E9F0]"
              >
                Gianna (Account 2)
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Footer Constraint Notice */}
      <p className="text-center text-xs text-[#64748B] mt-6">
        🔒 Strict Subcollection Isolation • Open Signups Disabled
      </p>
    </div>
  );
}

