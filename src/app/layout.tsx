import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Second Brain",
  description: "Frictionless personal knowledge base and second brain for Gustavo & Gianna",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Second Brain",
  },
};

import ServiceWorkerRegister from "@/components/pwa/ServiceWorkerRegister";
import { AuthProvider } from "@/context/AuthContext";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="nord" suppressHydrationWarning>
      <body
        className="min-h-screen bg-[#ECEFF4] text-[#2E3440] antialiased font-sans flex flex-col selection:bg-[#88C0D0]/30 selection:text-[#2E3440]"
        suppressHydrationWarning
      >
        <ServiceWorkerRegister />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
