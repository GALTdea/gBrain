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
  let resolvedUserId: string | null = null;
  let resolvedNoteId: string | null = null;

  try {
    const body = await req.json();
    const {
      userId,
      audioStorageUri,
      audioUrl,
      audioBase64,
      mimeType = "audio/webm",
      browserTranscript,
      clientTimeZone,
      noteId: customNoteId,
      targetNoteId,
      sharedContext,
    } = body;

    let effectiveAudioBase64 = audioBase64;
    let effectiveMimeType = mimeType;

    if (!userId || typeof userId !== "string") {
      return NextResponse.json(
        { error: "Valid userId is required" },
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

    resolvedUserId = userId;
    const noteId =
      targetNoteId ||
      customNoteId ||
      `voice_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    resolvedNoteId = noteId;

    // If audioBase64 was not provided but audioUrl is available (e.g. retry), fetch it
    if (!effectiveAudioBase64 && !audioStorageUri && audioUrl) {
      try {
        const audioFetchRes = await fetch(audioUrl);
        if (audioFetchRes.ok) {
          const arrayBuffer = await audioFetchRes.arrayBuffer();
          effectiveAudioBase64 = Buffer.from(arrayBuffer).toString("base64");
          if (!mimeType && audioFetchRes.headers.get("content-type")) {
            effectiveMimeType = audioFetchRes.headers.get("content-type")!;
          }
        }
      } catch (fetchErr) {
        console.warn("[Voice Route] Fetching audioUrl for analysis deferred:", fetchErr);
      }
    }

    if (!audioStorageUri && !effectiveAudioBase64 && !browserTranscript) {
      return NextResponse.json(
        { error: "Either audioStorageUri (gs://), audioBase64, audioUrl, or browserTranscript must be provided" },
        { status: 400 }
      );
    }

    // Step 1: Process multimodal audio via Gemini 1.5 Flash (transcription, summary, tags, shared context)
    const analysis = await processMultimodalVoiceMemo({
      audioStorageUri,
      audioBase64: effectiveAudioBase64,
      mimeType: effectiveMimeType,
      browserTranscript,
      clientTimeZone,
      sharedContext,
    });

    // Step 2: Format TipTap rich text document with audio link, structured headings, and shared context
    const tipTapDoc = formatVoiceTipTapDoc(
      analysis.summary,
      analysis.transcript,
      audioUrl,
      sharedContext
    );

    // Step 3: Combine plain text for vector search & embeddings
    let plainText = `${analysis.title}\n\nSummary:\n${analysis.summary}\n\nTranscript:\n${analysis.transcript}`;
    if (sharedContext?.url) {
      plainText = `Referenced: ${sharedContext.title || sharedContext.url}\nURL: ${sharedContext.url}\n\n${plainText}`;
    }

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
      status: "ready",
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
            status: "ready",
            processingError: null,
            embedding: FieldValue.vector(embedding),
          },
          { merge: true }
        );
      } catch {
        await noteRef.set(
          {
            ...noteData,
            status: "ready",
            processingError: null,
          },
          { merge: true }
        );
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

    // Mark note as failed in Firestore so the user doesn't see a permanent spinner
    if (resolvedUserId && resolvedNoteId) {
      try {
        const db = getAdminFirestore();
        const noteRef = db.doc(`users/${resolvedUserId}/notes/${resolvedNoteId}`);
        await noteRef.set(
          {
            status: "failed",
            processingError: message,
            updatedAt: Date.now(),
          },
          { merge: true }
        );
      } catch (dbErr) {
        console.warn("[Voice Route] Could not record failed status in Firestore:", dbErr);
      }
    }

    return NextResponse.json({ error: message, noteId: resolvedNoteId }, { status: 500 });
  }
}

