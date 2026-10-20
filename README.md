# 🧠 Second Brain (`gBrain`)

A zero-cost, frictionless personal knowledge management Progressive Web App (PWA) built for **Gustavo & Gianna**.

`gBrain` combines instant multi-channel capture (1-tap voice memos, Android/OS Web Share Target for links and audio, and a unified Omnibar) with rich TipTap block editing and grounded conversational RAG search powered by 768-dimensional Vertex AI / Gemini embeddings.

---

## 📚 Project Documentation (`docs/`)

All product decisions, architectural invariants, and staged implementation plans live in the repository's [`docs/`](./docs/) directory:

* **Product Documentation (`docs/product/`):**
  * [Product Overview & User Journeys](./docs/product/overview.md)
  * [Features Matrix & Future Roadmap Candidates](./docs/product/features.md)
* **Architecture Documentation (`docs/architecture/`):**
  * [System Design & Directory Structure](./docs/architecture/system-design.md)
  * [Data Model, Storage & Security Rules](./docs/architecture/data-and-security.md)
  * [AI, Hybrid RAG Search & Capture Pipelines](./docs/architecture/ai-and-capture-pipelines.md)
* **Development Stages (`docs/stages/`):**
  * [Stage 00: Completed Foundation (Phases 1–4 + Voice & Capture)](./docs/stages/00-completed-foundation.md)
  * [Stage Plan Template](./docs/stages/TEMPLATE.md)
* **Agent Instructions:**
  * [`AGENTS.md`](./AGENTS.md)

---

## 🛠️ Tech Stack
* **Frontend:** Next.js `16.4` (App Router), React `19`, TypeScript `5`, Tailwind CSS `v4`, DaisyUI `v5`
* **Editor:** TipTap (`@tiptap/react`, `@tiptap/starter-kit`)
* **Auth & Database:** Firebase Authentication, Cloud Firestore (`users/{userId}/notes`), Firebase Storage (`users/{userId}/audio`)
* **AI & Embeddings:** Google Cloud Vertex AI / Gemini API (`gemini-2.5-flash` / `gemini-1.5-flash` & `text-embedding-004` / `gemini-embedding-001` 768-dim vectors)
* **Hosting:** Firebase App Hosting ([`apphosting.yaml`](./apphosting.yaml))

---

## 🚀 Local Setup & Development

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env.local` and populate your Firebase and Google Cloud settings:
```bash
cp .env.example .env.local
```

For server-side Vertex AI and Admin Firestore access during local development, authenticate via Application Default Credentials (ADC) or provide a `GEMINI_API_KEY`:
```bash
gcloud auth application-default login
```
*(Note: If Firebase or GCP credentials are omitted locally, `gBrain` gracefully supports an offline Demo Mode for both Gustavo and Gianna backed by `localStorage` and deterministic 768-dim mock embeddings.)*

### 3. Run the Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Lint & Production Build
```bash
npm run lint
npm run build
```
