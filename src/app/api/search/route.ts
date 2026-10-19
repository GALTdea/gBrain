import { NextRequest, NextResponse } from "next/server";
import {
  generateTextEmbedding,
  getAdminFirestore,
  generateRAGAnswer,
  cosineSimilarity,
} from "@/lib/firebase/admin";
import { Note } from "@/types/note";

const STOP_WORDS = new Set([
  "what", "is", "for", "the", "a", "an", "and", "or", "in", "on", "at", "to", "of", "with",
  "by", "from", "about", "how", "why", "when", "where", "who", "which", "are", "was", "were",
  "be", "been", "being", "have", "has", "had", "do", "does", "did", "our", "my", "your",
  "their", "this", "that", "these", "those", "i", "you", "he", "she", "it", "we", "they",
  "me", "him", "her", "us", "them", "can", "could", "will", "would", "shall", "should"
]);

function extractKeywords(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

function isQualityNote(note: { plain_text?: string; content?: unknown }): boolean {
  const text = (note.plain_text || "").trim();
  if (text.length < 15) {
    return false;
  }
  if (text.includes("Full multimodal transcription deferred")) {
    return false;
  }
  if (
    typeof note.content === "string" &&
    note.content.includes("Full multimodal transcription deferred")
  ) {
    return false;
  }
  if (
    typeof note.content === "object" &&
    note.content !== null &&
    JSON.stringify(note.content).includes("Full multimodal transcription deferred")
  ) {
    return false;
  }
  return true;
}

interface CandidateNote {
  id: string;
  title: string;
  plain_text: string;
  content?: unknown;
  tags?: string[];
  baseScore?: number;
  score?: number;
  embedding?: number[];
}

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
    const queryWords = extractKeywords(cleanQuery);

    // Step 1: Generate 768-dimensional embedding for search query via text-embedding-004
    const queryEmbedding = await generateTextEmbedding(cleanQuery);

    let candidateNotes: CandidateNote[] = [];
    let usedVectorSearch = false;

    // Step 2: Query Firestore using findNearest scoped strictly to users/{userId}/notes
    try {
      const db = getAdminFirestore();
      const notesRef = db.collection(`users/${userId}/notes`);

      try {
        const vectorQuery = notesRef.findNearest({
          vectorField: "embedding",
          queryVector: queryEmbedding,
          limit: 30,
          distanceMeasure: "COSINE",
          distanceResultField: "distance",
        });

        const snapshot = await vectorQuery.get();
        if (snapshot.docs.length > 0) {
          const notesFromVector = snapshot.docs
            .map((docSnap) => {
              const data = docSnap.data();
              const distance = typeof data.distance === "number" ? data.distance : 0.5;
              // Cosine distance = 1 - cosine similarity
              const baseScore = Math.max(0, Math.min(1, 1 - distance));
              return {
                id: docSnap.id,
                title: data.title || "Untitled Note",
                plain_text: data.plain_text || "",
                content: data.content,
                tags: data.tags || [],
                baseScore,
                embedding: data.embedding,
              };
            })
            .filter(isQualityNote);

          if (notesFromVector.length > 0) {
            candidateNotes = notesFromVector;
            usedVectorSearch = true;
          }
        }
      } catch (findNearestErr) {
        console.warn(
          "[Search Route] findNearest index deferred or not built yet. Over-fetching (Architectural Rule 2):",
          findNearestErr
        );
      }

      // Over-fetch matches if findNearest returned 0 or errored (Architectural Rule 2)
      if (!usedVectorSearch) {
        const snapshot = await notesRef.orderBy("updatedAt", "desc").limit(250).get();
        if (snapshot.docs.length > 0) {
          candidateNotes = snapshot.docs
            .map((docSnap) => {
              const data = docSnap.data();
              return {
                id: docSnap.id,
                title: data.title || "Untitled Note",
                plain_text: data.plain_text || "",
                content: data.content,
                tags: data.tags || [],
                embedding: data.embedding,
              };
            })
            .filter(isQualityNote);
        }
      }
    } catch (dbErr) {
      console.warn("[Search Route] Firestore Admin access deferred:", dbErr);
    }

    // Step 2b: Fallback to localNotes if Firestore subcollection returned fewer notes (e.g. offline, unindexed, or demo mode)
    if (
      (!candidateNotes.length || (localNotes && localNotes.length > candidateNotes.length)) &&
      Array.isArray(localNotes) &&
      localNotes.length > 0
    ) {
      const filteredLocal = localNotes
        .map((n: Note) => ({
          id: n.id,
          title: n.title || "Untitled Note",
          plain_text: n.plain_text || "",
          content: n.content,
          tags: n.tags || [],
          embedding: n.embedding,
        }))
        .filter(isQualityNote);

      if (filteredLocal.length > candidateNotes.length || candidateNotes.length === 0) {
        candidateNotes = filteredLocal;
        usedVectorSearch = false;
      }
    }

    // Step 2c: Hybrid Scoring (Vector + Keyword/Tag Boost) and Ranking
    const matchedNotes = candidateNotes
      .map((note) => {
        let baseScore = 0;
        if (note.baseScore !== undefined) {
          baseScore = note.baseScore;
        } else if (note.embedding && Array.isArray(note.embedding) && note.embedding.length > 0) {
          baseScore = cosineSimilarity(queryEmbedding, note.embedding);
        } else {
          // Text keyword presence fallback
          const lowerText = note.plain_text.toLowerCase();
          const lowerTitle = note.title.toLowerCase();
          let matches = 0;
          queryWords.forEach((w) => {
            if (lowerTitle.includes(w)) matches += 2;
            if (lowerText.includes(w)) matches += 1;
          });
          const denom = Math.max(1, queryWords.length * 2);
          baseScore = matches > 0 ? Math.min(0.95, 0.4 + (matches / denom) * 0.5) : 0.1;
        }

        let finalScore = baseScore;

        // Tag boost: +0.15 if any query word exactly matches a note's tag (e.g. tag #restoration matches query word restoration)
        const hasTagMatch = (note.tags || []).some((tag) => {
          const normalizedTag = tag.toLowerCase().replace(/^#/, "").trim();
          return queryWords.some((qw) => qw === normalizedTag);
        });
        if (hasTagMatch) {
          finalScore += 0.15;
        }

        // Title boost: +0.10 if a query word appears in the note's title
        const lowerTitle = (note.title || "").toLowerCase();
        const hasTitleMatch = queryWords.some((qw) => lowerTitle.includes(qw));
        if (hasTitleMatch) {
          finalScore += 0.10;
        }

        const score = Math.round(finalScore * 100) / 100;
        return {
          id: note.id,
          title: note.title,
          plain_text: note.plain_text,
          tags: note.tags,
          score,
        };
      })
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 30);

    // Step 3: Pass matched notes to Gemini for conversational synthesis
    const systemInstruction =
      "Analyze ALL provided notes that match the topic. Synthesize a unified, structured answer addressing each aspect of the user's question (e.g., break down by person, family, church if asked). Group insights conceptually rather than listing notes one by one. Cite every claim with [Note: Title].";

    const answer = await generateRAGAnswer(cleanQuery, matchedNotes, systemInstruction);

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
