# Stage 01: Deterministic Work Logs & Chronological Timeline

* **Status:** Planned
* **Created:** 2026-10-21
* **Completed:** Pending

---

## 1. Objectives
Enable frictionless, guaranteed documentation of work and union activities (e.g. for Gianna) and provide deterministic (100% complete, zero dropped entries) chronological review and weekly timesheet hour rollups.

While semantic/vector search (`findNearest`) excels at exploratory ideation and problem-solving, work logs and timesheets require pure database determinism across specific date ranges (`createdAt`).

---

## 2. Scope & Deliverables
* [ ] **PWA Shortcut & Target Tag Ingestion:**
  * Add a "Log Work" app shortcut in `public/manifest.json` routed to `/capture?mode=voice&autostart=1&tag=union`.
  * Update `src/app/capture/page.tsx` and `src/components/voice/VoiceRecorder.tsx` to read the `tag` search parameter and pass it to `/api/voice` as a pre-assigned tag.
  * Update `/api/voice/route.ts` to guarantee that if a target tag is specified, it is included in `note.tags`.
* [ ] **Deterministic Date-Range Filter Bar:**
  * Add a date-range filter UI on `NotesDashboard.tsx` (`[ All ]`, `[ Today ]`, `[ This Week ]`, `[ Last Week ]`, `[ Custom Range 📅 ]`).
  * Filter active notes by timestamp (`createdAt`), combined with the existing `#tag` filter bar.
  * Ensure sorting can toggle between `Newest First` and `Chronological (Oldest First)` for audit/timesheet review.
* [ ] **Weekly Timesheet & Activity Rollup (`/api/timesheet`):**
  * Add a "✨ Summarize for Timesheet" button when viewing notes filtered by a date range and `#union` (or `#work`).
  * Send the exact list of notes from that window to Gemini to synthesize an organized breakdown of hours worked, activities completed, and pending follow-ups with links to the underlying audio notes.

---

## 3. Architectural Constraints & Decisions
* Adhere strictly to the Core Architectural Rules in [`AGENTS.md`](../../AGENTS.md):
  * All queries scoped strictly to `users/{userId}/notes`.
  * Date-range filtering operates on indexed `createdAt` timestamps.
  * No vector search for timesheet review: deterministic database filtering guarantees 0 missed logs.
* Key files to modify or create:
  * `public/manifest.json`
  * `src/app/capture/page.tsx`
  * `src/components/voice/VoiceRecorder.tsx`
  * `src/app/api/voice/route.ts`
  * `src/components/dashboard/NotesDashboard.tsx`
  * `src/app/api/timesheet/route.ts` (new)

---

## 4. Verification & Acceptance Criteria
* [ ] TypeScript & ESLint checks pass (`npm run lint`, `npm run build`).
* [ ] Verify that opening `/capture?mode=voice&tag=union` auto-tags the created note with `#union`.
* [ ] Verify that selecting `This Week` on the dashboard displays only notes created within the current calendar week in chronological order.
* [ ] Verify that the timesheet summary accurately reflects all notes in the selected window.
* [ ] Update `docs/product/` and `docs/stages/` upon completion.

---

## 5. Implementation Summary (Filled Upon Completion)
* **Changes Made:**
* **Tests & Verification:**
* **Follow-ups / Deferred Items:**

