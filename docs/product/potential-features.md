# Potential & Tentative Features

This document catalogs potential features, UX enhancements, and architectural extensions identified during product brainstorming. These candidates are evaluated against the core philosophy of `gBrain`: **zero-friction capture, dual-mode retrieval, and zero-cost serverless architecture.**

---

## 1. Targeted Capture & Context Locking (Step 2 Candidate)

### The Problem
While unconstrained AI auto-tagging is fine for personal brainstorms, work and union logs require high confidence that notes are categorized correctly without burdening the user with manual filing or typing tags.

### Proposed Solutions
1. **Dedicated PWA Home Screen Shortcuts:**
   * In addition to "Instant Voice Note" and "Quick Text Capture", add a **"Log Work"** shortcut in `manifest.json`.
   * Routes to `/capture?mode=voice&autostart=1&tag=union`.
   * When launched from this shortcut, the `#union` / `#work` tag is hard-locked and applied automatically.
2. **URL Parameter Tag Ingestion:**
   * Support a `?tag=` query param on `/capture` that pre-populates note tags in both manual capture and voice recording flows.
3. **Pre-Capture / In-Flight Context Pills (Optional):**
   * While recording or right before saving on `/capture`, display large thumb-friendly pills: `[ ✨ Auto ]` `[ 💼 Work ]` `[ 💡 Idea ]` `[ 📌 Follow-up ]`.
   * Defaults to `Auto` (zero extra friction), but lets the user lock a bucket in 1 tap with their thumb.
4. **Post-Capture 1-Tap Category Switcher:**
   * On the post-save confirmation card in `/capture`, show a single row of category pills so the user can re-assign the tag with 1 tap if desired before closing.

---

## 2. Deterministic Date-Range Timeline & Audit Filter (Step 3 Candidate)

### The Problem
Vector/semantic search (`findNearest`) is non-exhaustive and can omit notes based on cosine similarity thresholds. For timesheets, work logs, or legal/union documentation, the user needs 100% certainty that every note created in a given time window is retrieved.

### Proposed Solutions
1. **Date-Range Filter Bar on Dashboard:**
   * Positioned directly below the Omnibar on `NotesDashboard.tsx`.
   * Preset Pills: `[ All Time ]` `[ Today ]` `[ Yesterday ]` `[ This Week ]` `[ Last Week ]` `[ Custom Range 📅 ]`.
2. **Pure Database Timestamp Filtering:**
   * Queries Firestore by indexed `createdAt` timestamps:
     `where("createdAt", ">=", startOfWeek).where("createdAt", "<=", endOfWeek)`
   * Combined with active `#tag` filters (e.g. `#union`), this guarantees zero dropped entries.
3. **Chronological Sort Toggle:**
   * Allow switching between `Newest First` (default for quick review) and `Chronological (Oldest First)` (ideal for chronological audit trails and reading through a week's timeline).

---

## 3. Weekly Timesheet & Activity Rollup (Step 4 Candidate)

### The Problem
Translating raw, spoken field logs from an entire week into a structured timesheet or report is tedious and repetitive.

### Proposed Solutions
1. **"✨ Summarize for Timesheet" Action:**
   * Appears on the Dashboard whenever a date range (e.g. `This Week`) is selected.
2. **Grounded Timesheet Synthesis API (`/api/timesheet`):**
   * Passes the exact list of notes from the filtered date range to Gemini.
   * Gemini extracts dates, estimated hours/durations mentioned, activities conducted, and pending follow-ups.
   * Outputs a clean, copy-pasteable Markdown table or formatted digest:
     ```markdown
     ### Weekly Timesheet Summary: Oct 14 – Oct 18
     * Mon Oct 14 (1.5 hrs): Steward briefing on shift scheduling.
     * Tue Oct 15 (1.0 hr): Member discussion with Sarah regarding overtime.
     Total Estimated Hours: 16.5 hrs
     Pending Action Items: 2
     ```
3. **Traceability:**
   * Every item in the generated timesheet links directly back to the original note card, audio recording, and verbatim transcript for instant verification.

---

## 4. "Living Lists" vs. Standalone Notes (Smart Append Mode)

### The Problem
For recurring checklists (e.g. packing lists, Costco trips, or punch lists), dictating 10 items over 3 days creates 10 separate voice note cards, cluttering the dashboard feed.

### Proposed Solutions
1. **List-Append Intent Detection:**
   * When a voice note begins with *"Add ... to the packing list"* or *"Add ... to the grocery list"*, Gemini detects an `append_to_list` intent.
2. **Pinned Checklist Integration:**
   * Looks up the user's pinned checklist note with that title or tag.
   * Appends the new items as unchecked TipTap checklist nodes (`[ ]`) to that single living note, keeping a brief timestamped voice log at the bottom.

---

## 5. Native Calendar Deep-Link Bridge

### The Problem
`gBrain` should not try to be a full calendar or alarm app (due to mobile OS background throttling on web apps), but users often dictate notes containing appointment times (e.g. *"Doctor follow-up next Tuesday at 3 PM"*).

### Proposed Solutions
1. **Date/Time Extraction in Voice Route:**
   * If Gemini detects a concrete appointment or event date in the audio memo, it populates `eventDetails: { title, startIso, endIso, location }` in the note metadata.
2. **1-Tap Google Calendar Button:**
   * Renders a **"📅 Add to Google Calendar"** button on the note card and capture confirmation screen.
   * Generates a pre-filled Google Calendar web link (`https://calendar.google.com/calendar/render?action=TEMPLATE&text=...&dates=...`).
   * Tapping it opens Google Calendar with all fields filled in, placing the hard alarm on the user's phone in 1 tap without any complex calendar sync infrastructure.

---

## 6. Evaluation Matrix

| Feature Candidate | Target Persona | Complexity | Value / Impact | Status |
| :--- | :--- | :--- | :--- | :--- |
| **PWA "Log Work" Shortcut & Tag Ingestion** | Gianna | Low | High (Zero friction, 100% tag accuracy) | **Prioritized for Stage 01** |
| **Deterministic Date Filter Bar** | Gianna & Gustavo | Medium | High (Audit certainty, zero dropped logs) | **Prioritized for Stage 01** |
| **Weekly Timesheet Rollup** | Gianna | Medium | High (Saves 1-2 hours of weekly admin time) | **Prioritized for Stage 01** |
| **Google Calendar Deep Link Bridge** | Both | Low | Medium (Seamless bridge to native OS alarms) | Backlog / Candidate |
| **Living Lists / Smart Append Mode** | Both | Medium-High | Medium (Reduces note clutter for checklists) | Backlog / Candidate |

