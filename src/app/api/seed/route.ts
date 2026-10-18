import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import {
  generateTextEmbedding,
  getAdminFirestore,
  FieldValue,
} from "@/lib/firebase/admin";
import { Note } from "@/types/note";

interface ParsedKeepNote {
  title: string;
  labels: string[];
  status?: string;
  editedIso: string;
  timestamp: number;
  body: string;
  links: string[];
  plain_text: string;
}

function parseKeepMarkdown(content: string): ParsedKeepNote[] {
  // Split on note boundary lines that start with "## "
  const rawNotes = content.split(/^## /m).slice(1);
  const notes: ParsedKeepNote[] = [];

  for (const raw of rawNotes) {
    const lines = raw.split("\n");
    let rawTitle = lines[0].trim();

    // Strip trailing '---' if it exists at the end of the note chunk
    let remaining = lines.slice(1).join("\n").replace(/\n---\s*$/, "").trim();

    // Extract Labels
    const labelsMatch = remaining.match(/Labels:\s*(.+)/);
    const labels: string[] = [];
    if (labelsMatch) {
      const tagMatches = labelsMatch[1].match(/`([^`]+)`/g) || [];
      for (const m of tagMatches) {
        // Strip backticks and leading '#' if present (UI already renders #{tag})
        const cleanTag = m.replace(/`/g, "").replace(/^#/, "").trim();
        if (cleanTag) labels.push(cleanTag);
      }
    }

    // Extract Edited timestamp
    const editedMatch = remaining.match(/Edited:\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+(PST|PDT)/);
    let timestamp = Date.now();
    let editedIso = new Date().toISOString();
    if (editedMatch) {
      const [, ymd, hm, tz] = editedMatch;
      const offset = tz === "PDT" ? "-07:00" : "-08:00";
      editedIso = `${ymd}T${hm}:00${offset}`;
      const parsedTs = Date.parse(editedIso);
      if (!isNaN(parsedTs)) {
        timestamp = parsedTs;
      }
    }

    // Extract Status (e.g. pinned)
    const statusMatch = remaining.match(/Status:\s*([^\n]+)/);
    const status = statusMatch ? statusMatch[1].trim() : undefined;
    if (status && status.toLowerCase().includes("pinned")) {
      if (!labels.includes("pinned")) {
        labels.push("pinned");
      }
    }

    // Extract Links: section
    let body = "";
    const links: string[] = [];
    const linksIndex = remaining.indexOf("Links:");
    if (linksIndex !== -1) {
      const linksSection = remaining.slice(linksIndex);
      const linkLines = linksSection.split("\n").filter((l) => l.trim().startsWith("- ["));
      links.push(...linkLines);
      remaining = remaining.slice(0, linksIndex).trim();
    }

    // Remove the metadata header lines from the body
    const bodyLines = remaining.split("\n").filter((l) => {
      const trimmed = l.trim();
      return (
        !trimmed.startsWith("Labels:") &&
        !trimmed.startsWith("Edited:") &&
        !trimmed.startsWith("Status:")
      );
    });

    body = bodyLines.join("\n").trim();

    // If title is literal "(untitled)", see if there's a link title in Links or first body line
    if (rawTitle.toLowerCase() === "(untitled)") {
      if (links.length > 0) {
        const linkTitleMatch = links[0].match(/\[([^\]]+)\]/);
        if (linkTitleMatch && linkTitleMatch[1]) {
          rawTitle = `(untitled) - ${linkTitleMatch[1]}`;
        }
      } else if (body) {
        const firstLine = body.split("\n")[0].trim();
        if (firstLine && !firstLine.startsWith("http")) {
          rawTitle = `(untitled) - ${firstLine.slice(0, 50)}`;
        }
      }
    }

    // Construct unified plain_text for vector search & embeddings
    const plainParts: string[] = [rawTitle];
    if (body) plainParts.push(body);
    if (links.length > 0) plainParts.push(`Links:\n${links.join("\n")}`);
    const plain_text = plainParts.join("\n\n").trim();

    notes.push({
      title: rawTitle,
      labels,
      status,
      editedIso,
      timestamp,
      body,
      links,
      plain_text,
    });
  }

  return notes;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId } = body;

    if (!userId || typeof userId !== "string") {
      return NextResponse.json({ error: "Valid userId is required" }, { status: 400 });
    }

    // Read the Markdown file from data/lords_favor_restoration_notes.md
    const filePath = path.join(process.cwd(), "data", "lords_favor_restoration_notes.md");
    if (!fs.existsSync(filePath)) {
      return NextResponse.json(
        { error: `File not found at ${filePath}. Please ensure data/lords_favor_restoration_notes.md exists.` },
        { status: 404 }
      );
    }

    const fileContent = fs.readFileSync(filePath, "utf-8");
    const parsedNotes = parseKeepMarkdown(fileContent);

    if (parsedNotes.length === 0) {
      return NextResponse.json(
        { error: "No notes found in file. Expected markdown with '## ' note headers." },
        { status: 400 }
      );
    }

    const seededNotes: Note[] = [];
    const batchSize = 5;

    // Process notes in batches to compute embeddings safely
    for (let i = 0; i < parsedNotes.length; i += batchSize) {
      const chunk = parsedNotes.slice(i, i + batchSize);
      await Promise.all(
        chunk.map(async (p, idx) => {
          const globalIdx = i + idx;
          const noteId = `keep_note_${String(globalIdx + 1).padStart(3, "0")}`;

          // Generate TipTap document JSON
          const paragraphs = p.body ? p.body.split("\n\n").filter(Boolean) : [];
          const contentBlocks = paragraphs.map((par) => ({
            type: "paragraph",
            content: [{ type: "text", text: par }],
          }));

          if (p.links.length > 0) {
            contentBlocks.push({
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: `Links:\n${p.links.join("\n")}`,
                },
              ],
            });
          }

          if (contentBlocks.length === 0) {
            contentBlocks.push({
              type: "paragraph",
              content: [{ type: "text", text: p.title }],
            });
          }

          const tipTapContent = {
            type: "doc",
            content: contentBlocks,
          };

          // Generate 768-dim embedding
          let embedding: number[] | undefined;
          try {
            embedding = await generateTextEmbedding(p.plain_text);
          } catch (embedErr) {
            console.warn(`[Seed API] Embedding failed for note ${noteId}:`, embedErr);
          }

          const noteRecord: Note = {
            id: noteId,
            title: p.title,
            content: tipTapContent,
            plain_text: p.plain_text,
            tags: p.labels,
            embedding,
            userId,
            createdAt: p.timestamp,
            updatedAt: p.timestamp,
          };

          seededNotes[globalIdx] = noteRecord;
        })
      );
    }

    // If Firestore is available and not a mock demo user, write to Firestore
    let persistedToFirestore = false;
    if (!userId.startsWith("usr_")) {
      try {
        const db = getAdminFirestore();
        const batch = db.batch();

        for (const note of seededNotes) {
          const noteRef = db.doc(`users/${userId}/notes/${note.id}`);
          const dataToSave: Record<string, unknown> = {
            title: note.title,
            content: note.content,
            plain_text: note.plain_text,
            tags: note.tags || [],
            userId: note.userId,
            createdAt: note.createdAt,
            updatedAt: note.updatedAt,
            hasEmbedding: Boolean(note.embedding),
            embeddingUpdatedAt: Date.now(),
          };

          if (note.embedding) {
            try {
              dataToSave.embedding = FieldValue.vector(note.embedding);
            } catch {
              dataToSave.embedding = note.embedding;
            }
          }

          batch.set(noteRef, dataToSave, { merge: true });
        }

        await batch.commit();
        persistedToFirestore = true;
      } catch (dbErr) {
        console.warn("[Seed API] Firestore batch write deferred:", dbErr);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Successfully seeded ${seededNotes.length} notes from Google Keep backup.`,
      notesCount: seededNotes.length,
      persistedToFirestore,
      notes: seededNotes,
    });
  } catch (error: unknown) {
    console.error("[Seed API Error]:", error);
    const message = error instanceof Error ? error.message : "Failed to seed notes";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
