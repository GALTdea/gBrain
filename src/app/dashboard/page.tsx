"use client";

import { useAuth } from "@/context/AuthContext";
import NotesDashboard from "@/components/dashboard/NotesDashboard";
import LoginForm from "@/components/auth/LoginForm";

function DashboardContent() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <span className="loading loading-spinner loading-lg text-[#5E81AC]"></span>
        <span className="text-xs text-[#64748B] font-mono tracking-wider">
          AUTHENTICATING SECOND BRAIN...
        </span>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="w-full flex-1 flex items-center justify-center p-4">
        <LoginForm />
      </div>
    );
  }

  return (
    <div className="w-full flex-1 p-4 sm:p-8">
      <NotesDashboard />
    </div>
  );
}

export default function DashboardPage() {
  return (
    <div className="min-h-screen flex flex-col justify-between">
      <DashboardContent />
      <footer className="footer footer-center p-4 text-xs text-[#64748B] border-t border-[#D8DEE9]">
        <aside>
          <p>Second Brain • Gustavo &amp; Gianna</p>
        </aside>
      </footer>
    </div>
  );
}

