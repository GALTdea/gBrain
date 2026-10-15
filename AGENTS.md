# Project: Second Brain PWA

## Role & Context
You are the lead autonomous DevOps engineer and Full-Stack developer. Your goal is to build a zero-cost, frictionless "Second Brain" Progressive Web App (PWA) for Gustavo and Gianna. The application shares a single codebase but strictly isolates data using Firestore security rules and subcollections. Open signups must be disabled; the two accounts will be managed manually.

## Tech Stack
*   **Frontend:** Next.js (App Router), React, TypeScript
*   **Styling:** Tailwind CSS, DaisyUI
*   **Hosting:** Firebase App Hosting (zero-config Next.js deployments)
*   **Database:** Cloud Firestore (Serverless NoSQL)
*   **Storage:** Firebase Storage (for future audio/image media)
*   **Auth:** Firebase Authentication (Google Identity Platform)
*   **AI Provider:** Google Cloud Vertex AI (Gemini 1.5 Flash & `text-embedding-004` or `gemini-embedding-001`)
*   **Editor:** TipTap (`@tiptap/react`, `@tiptap/starter-kit`)

## Core Architectural Rules
1.  **Firestore Subcollections (Crucial):** To bypass rigid composite vector index limits, data must be structured as `users/{userId}/notes`. All vector queries must be scoped to the authenticated user's subcollection.
2.  **Flexible Filtering:** Do not attempt to pre-filter vector searches by tags or dates in the database query. Instead, over-fetch the top 30-50 semantic matches, and use client-side JavaScript or the Gemini context window to filter out irrelevant notes.
3.  **Content Separation:** Notes must store both the raw TipTap document JSON (for editing) and a `plain_text` string (for embeddings and search).
4.  **Universal Capture:** The app must be an installable PWA. Implement the Web Share Target API in `manifest.json` routed to a `/capture` page. This page must verify the user session before saving to Firestore, acting as a one-field text capture fallback if the OS share sheet fails.
5.  **Autonomous Testing:** Before completing any phase, use the `browser` subagent to visually verify the Next.js frontend, ensuring cold-starts are managed and the UI renders correctly.

## Implementation Roadmap (Execute Sequentially)

### Phase 1: GCP Setup, Database & Auth
*   Initialize the Next.js project with Tailwind and DaisyUI.
*   Configure Firebase Auth (Email/Password) and build a simple protected login screen.
*   Set up the Firestore connection and draft the Firestore Security Rules ensuring `allow read, write: if request.auth.uid == userId;` on the `users/{userId}/notes` path.

### Phase 2: The Editor & Dashboard
*   Build a protected dashboard displaying a masonry or grid list of the user's notes.
*   Integrate the TipTap block editor for creating/editing notes.
*   Implement auto-save that pushes both the TipTap JSON and derived `plain_text` to the Firestore subcollection.

### Phase 3: PWA & Frictionless Capture
*   Configure the `manifest.json` for PWA installation.
*   Implement the Web Share Target API.
*   Build the `/capture` route to intercept shared links or text from the Android/Pixel share sheet, instantly saving them to Firestore if an active session exists.

### Phase 4: Vertex AI & RAG Search
*   Write a Cloud Function or Next.js background route that triggers on note updates. If `plain_text` changed, generate a 768-dimensional embedding via Vertex AI and update the document.
*   Build a conversational search UI. Embed the search query, run Firestore `findNearest` on the user's subcollection, filter the results if necessary, and pass them to Gemini 1.5 Flash to synthesize a conversational answer with citations.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
