import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Second Brain",
  description: "Frictionless personal knowledge base and second brain for Gustavo & Gianna",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Second Brain",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body
        className="min-h-screen bg-base-100 text-base-content antialiased font-sans flex flex-col"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
