import { NextRequest, NextResponse } from "next/server";
import {
  generateTextEmbedding,
  generateRAGAnswer,
  getAdminFirestore,
  cosineSimilarity,
} from "@/lib/firebase/admin";
import { Note } from "@/types/note";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { query, userId, localNotes } = body;

    if (!query || typeof query !== "string" || !query.trim()) {
      return NextResponse.json(
        { error: "Natural language query string is required" },
        { status: 400 }
      );
    }

    if (
      !userId ||
      typeof userId !== "string" ||
      userId.includes("/") ||
      userId.includes("..")
    ) {
      return NextResponse.json(
        { error: "Valid User ID is required" },
        { status: 400 }
      );
    }

    const cleanQuery = query.trim().slice(0, 1000);

    // Step 1: Generate 768-dimensional embedding for search query via text-embedding-004
    const queryEmbedding = await generateTextEmbedding(cleanQuery);

    let matchedNotes: Array<{
      id: string;
      title: string;
      plain_text: string;
      tags?: string[];
      score?: number;
      embedding?: number[];
    }> = [];

    let usedVectorSearch = false;

    // Step 2: Query Firestore using findNearest scoped strictly to users/{userId}/notes
    try {
      const db = getAdminFirestore();
      const notesRef = db.collection(`users/${userId}/notes`);

      try {
        const vectorQuery = notesRef.findNearest({
          vectorField: "embedding",
          queryVector: queryEmbedding,
          limit: 15,
          distanceMeasure: "COSINE",
          distanceResultField: "distance",
        });

        const snapshot = await vectorQuery.get();
        if (snapshot.docs.length > 0) {
          matchedNotes = snapshot.docs.map((docSnap) => {
            const data = docSnap.data();
            const distance = typeof data.distance === "number" ? data.distance : 0.5;
            // Cosine distance = 1 - cosine similarity
            const score = Math.max(0, Math.min(1, 1 - distance));
            return {
              id: docSnap.id,
              title: data.title || "Untitled Note",
              plain_text: data.plain_text || "",
              tags: data.tags || [],
              score: Math.round(score * 100) / 100,
            };
          });
          usedVectorSearch = true;
        }
      } catch (findNearestErr) {
        console.warn(
          "[Search Route] findNearest index deferred or not built yet. Over-fetching (Architectural Rule 2):",
          findNearestErr
        );
      }

      // Over-fetch top 30-50 matches if findNearest returned 0 or errored
      if (!usedVectorSearch) {
        const snapshot = await notesRef.orderBy("updatedAt", "desc").limit(40).get();
        if (snapshot.docs.length > 0) {
          matchedNotes = snapshot.docs.map((docSnap) => {
            const data = docSnap.data();
            return {
              id: docSnap.id,
              title: data.title || "Untitled Note",
              plain_text: data.plain_text || "",
              tags: data.tags || [],
              embedding: data.embedding,
            };
          });
        }
      }
    } catch (dbErr) {
      console.warn("[Search Route] Firestore Admin access deferred:", dbErr);
    }

    // Step 2b: Fallback to localNotes if Firestore subcollection returned 0 (offline or demo mode)
    if (matchedNotes.length === 0 && Array.isArray(localNotes) && localNotes.length > 0) {
      matchedNotes = localNotes.map((n: Note) => ({
        id: n.id,
        title: n.title || "Untitled Note",
        plain_text: n.plain_text || "",
        tags: n.tags || [],
        embedding: n.embedding,
      }));
    }

    // Score and rank matches by cosine similarity or text relevance if not already scored by findNearest
    if (!usedVectorSearch && matchedNotes.length > 0) {
      matchedNotes = matchedNotes
        .map((note) => {
          let score = 0;
          if (note.embedding && Array.isArray(note.embedding) && note.embedding.length > 0) {
            score = cosineSimilarity(queryEmbedding, note.embedding);
          } else {
            // Text keyword presence fallback
            const lowerQuery = cleanQuery.toLowerCase();
            const lowerText = note.plain_text.toLowerCase();
            const lowerTitle = note.title.toLowerCase();
            const words = lowerQuery.split(/\s+/).filter(Boolean);
            let matches = 0;
            words.forEach((w) => {
              if (lowerTitle.includes(w)) matches += 2;
              if (lowerText.includes(w)) matches += 1;
            });
            score = matches > 0 ? Math.min(0.95, 0.4 + (matches / (words.length * 2)) * 0.5) : 0.1;
          }
          return { ...note, score: Math.round(score * 100) / 100 };
        })
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, 15);
    }

    // Step 3: Construct prompt and pass matched notes to Gemini 1.5 Flash for conversational synthesis
    const answer = await generateRAGAnswer(cleanQuery, matchedNotes);

    return NextResponse.json({
      success: true,
      query: cleanQuery,
      answer,
      usedVectorSearch,
      sources: matchedNotes.map(({ id, title, plain_text, tags, score }) => ({
        id,
        title,
        snippet: plain_text.slice(0, 250),
        tags: tags || [],
        score: score !== undefined ? score : undefined,
      })),
      totalMatches: matchedNotes.length,
    });
  } catch (error: unknown) {
    console.error("[Search Route Error]:", error);
    const message = error instanceof Error ? error.message : "Failed to execute conversational search";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
