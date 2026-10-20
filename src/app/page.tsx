"use client";

import { AuthProvider, useAuth } from "@/context/AuthContext";
import LoginForm from "@/components/auth/LoginForm";
import NotesDashboard from "@/components/dashboard/NotesDashboard";

function MainContent() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <span className="loading loading-spinner loading-lg text-[#5E81AC]"></span>
        <span className="text-xs text-[#64748B] font-mono tracking-wider">
          INITIALIZING SECOND BRAIN...
        </span>
      </div>
    );
  }

  return (
    <main className="w-full flex-1 flex items-center justify-center p-4 sm:p-8">
      {user ? <NotesDashboard /> : <LoginForm />}
    </main>
  );
}

export default function Home() {
  return (
    <AuthProvider>
      <div className="min-h-screen flex flex-col justify-between">
        <MainContent />
        <footer className="footer footer-center p-4 text-xs text-[#64748B] border-t border-[#D8DEE9]">
          <aside>
            <p>Second Brain PWA • Gustavo & Gianna • Built on Next.js, Firebase & Vertex AI</p>
          </aside>
        </footer>
      </div>
    </AuthProvider>
  );
}
