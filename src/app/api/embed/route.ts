import { NextRequest, NextResponse } from "next/server";
import {
  generateTextEmbedding,
  getAdminFirestore,
  FieldValue,
} from "@/lib/firebase/admin";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text, userId, noteId } = body;

    if (!text || typeof text !== "string" || !text.trim()) {
      return NextResponse.json(
        { error: "Text string is required to generate an embedding" },
        { status: 400 }
      );
    }

    // Limit text length to prevent memory/API quota abuse
    const sanitizedText = text.trim().slice(0, 20000);

    // Generate 768-dimensional embedding via Vertex AI text-embedding-004
    const embedding = await generateTextEmbedding(sanitizedText);

    // If userId and noteId are provided, validate path segments and update Firestore
    if (userId && noteId) {
      if (
        typeof userId !== "string" ||
        typeof noteId !== "string" ||
        userId.includes("/") ||
        noteId.includes("/") ||
        userId.includes("..") ||
        noteId.includes("..")
      ) {
        return NextResponse.json(
          { error: "Invalid userId or noteId path parameters" },
          { status: 400 }
        );
      }

      try {
        const db = getAdminFirestore();
        const noteRef = db.doc(`users/${userId}/notes/${noteId}`);

        // Try storing with FieldValue.vector for vector indexing, fallback to standard array
        try {
          await noteRef.set(
            {
              embedding: FieldValue.vector(embedding),
              hasEmbedding: true,
              embeddingUpdatedAt: Date.now(),
            },
            { merge: true }
          );
        } catch {
          await noteRef.set(
            {
              embedding,
              hasEmbedding: true,
              embeddingUpdatedAt: Date.now(),
            },
            { merge: true }
          );
        }
      } catch (dbErr) {
        console.warn("[Embed Route] Firestore update skipped or deferred:", dbErr);
      }
    }

    return NextResponse.json({
      success: true,
      dimensions: embedding.length,
      model: "text-embedding-004",
      embedding,
    });
  } catch (error: unknown) {
    console.error("[Embed Route Error]:", error);
    const message = error instanceof Error ? error.message : "Failed to generate embedding";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

