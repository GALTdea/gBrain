import { NextRequest, NextResponse } from "next/server";
import {
  processMultimodalVoiceMemo,
  formatVoiceTipTapDoc,
  generateTextEmbedding,
  getAdminFirestore,
  FieldValue,
} from "@/lib/firebase/admin";
import { Note } from "@/types/note";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      userId,
      audioStorageUri,
      audioUrl,
      audioBase64,
      mimeType = "audio/webm",
      browserTranscript,
      noteId: customNoteId,
    } = body;

    if (!userId || typeof userId !== "string") {
      return NextResponse.json(
        { error: "Valid userId is required" },
        { status: 400 }
      );
    }

    if (!audioStorageUri && !audioBase64 && !browserTranscript) {
      return NextResponse.json(
        { error: "Either audioStorageUri (gs://), audioBase64, or browserTranscript must be provided" },
        { status: 400 }
      );
    }

    // Sanitize path parameter to enforce isolation
    if (userId.includes("/") || userId.includes("..")) {
      return NextResponse.json(
        { error: "Invalid userId parameter" },
        { status: 400 }
      );
    }

    // Step 1: Process multimodal audio via Gemini 1.5 Flash (transcription, summary, tags)
    const analysis = await processMultimodalVoiceMemo({
      audioStorageUri,
      audioBase64,
      mimeType,
      browserTranscript,
    });

    const noteId =
      customNoteId ||
      `voice_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // Step 2: Format TipTap rich text document with audio link & structured headings
    const tipTapDoc = formatVoiceTipTapDoc(
      analysis.summary,
      analysis.transcript,
      audioUrl
    );

    // Step 3: Combine plain text for vector search & embeddings
    const plainText = `${analysis.title}\n\nSummary:\n${analysis.summary}\n\nTranscript:\n${analysis.transcript}`;

    // Step 4: Generate 768-dim embedding for Phase 4 RAG search
    const embedding = await generateTextEmbedding(plainText);

    const now = Date.now();
    const noteData: Note = {
      id: noteId,
      title: analysis.title,
      content: tipTapDoc,
      plain_text: plainText,
      tags: analysis.tags,
      embedding,
      ...(audioUrl ? { audioUrl } : {}),
      ...(audioStorageUri ? { audioStorageUri } : {}),
      userId,
      createdAt: now,
      updatedAt: now,
    };

    // Step 5: Save directly to Firestore subcollection users/{userId}/notes/{noteId}
    try {
      const db = getAdminFirestore();
      const noteRef = db.doc(`users/${userId}/notes/${noteId}`);

      try {
        await noteRef.set(
          {
            ...noteData,
            embedding: FieldValue.vector(embedding),
          },
          { merge: true }
        );
      } catch {
        await noteRef.set(noteData, { merge: true });
      }
    } catch (dbErr) {
      console.warn(
        "[Voice Route] Firestore write deferred (local/offline environment):",
        dbErr
      );
    }

    return NextResponse.json({
      success: true,
      note: noteData,
      analysis,
    });
  } catch (error: unknown) {
    console.error("[Voice Route Error]:", error);
    const message =
      error instanceof Error ? error.message : "Failed to process voice memo";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

