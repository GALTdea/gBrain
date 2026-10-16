import { Firestore, FieldValue } from "@google-cloud/firestore";
import { VertexAI } from "@google-cloud/vertexai";
import { GoogleGenAI } from "@google/genai";

/**
 * Server-side Firestore initialization using Application Default Credentials (ADC).
 * When running in Google Cloud (Firebase App Hosting, Cloud Functions, Cloud Run),
 * ADC is automatically discovered from the environment.
 * For local development, run `gcloud auth application-default login`.
 */
let adminDb: Firestore | null = null;
export const getAdminFirestore = (): Firestore => {
  if (!adminDb) {
    const projectId =
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

    adminDb = new Firestore({
      projectId: projectId || undefined,
    });
  }
  return adminDb;
};

export { FieldValue };

/**
 * Server-side Vertex AI initialization using Application Default Credentials (ADC).
 */
let vertexAI: VertexAI | null = null;
export const getVertexAI = (): VertexAI => {
  if (!vertexAI) {
    const project =
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    const location = process.env.GOOGLE_CLOUD_LOCATION || "us-central1";

    vertexAI = new VertexAI({
      project: project || "",
      location,
    });
  }
  return vertexAI;
};

/**
 * Google Gen AI client configured for Vertex AI backend.
 */
let genAIClient: GoogleGenAI | null = null;
export const getGenAIClient = (): GoogleGenAI => {
  if (!genAIClient) {
    const project =
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    const location = process.env.GOOGLE_CLOUD_LOCATION || "us-central1";

    genAIClient = new GoogleGenAI({
      vertexai: true,
      project: project || undefined,
      location: location || "us-central1",
    });
  }
  return genAIClient;
};

/**
 * Deterministic fallback embedding generator for testing without GCP billing/credentials.
 * Generates normalized 768-dimensional float vector.
 */
export function generateDeterministicMockEmbedding(text: string, dimensions = 768): number[] {
  const embedding = new Array(dimensions).fill(0);
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  for (let d = 0; d < dimensions; d++) {
    const val = Math.sin(hash + d * 31.4159);
    embedding[d] = Math.round(val * 10000) / 10000;
  }
  const norm = Math.sqrt(embedding.reduce((acc, v) => acc + v * v, 0));
  return embedding.map((v) => v / (norm || 1));
}

/**
 * Generates a 768-dimensional vector embedding for text using Vertex AI text-embedding-004.
 */
export async function generateTextEmbedding(text: string): Promise<number[]> {
  const cleanText = text.trim();
  if (!cleanText) {
    return new Array(768).fill(0);
  }

  try {
    const client = getGenAIClient();
    const result = await client.models.embedContent({
      model: "text-embedding-004",
      contents: cleanText,
    });

    const candidateResult = result as {
      embeddings?: Array<{ values?: number[] }>;
      embedding?: { values?: number[] };
    };
    const values =
      candidateResult.embeddings?.[0]?.values ||
      candidateResult.embedding?.values;

    if (values && Array.isArray(values) && values.length > 0) {
      return values;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      "[Vertex AI Embed] Vertex API call deferred (ADC not configured or network unreachable). Falling back to deterministic embedding:",
      message
    );
  }

  return generateDeterministicMockEmbedding(cleanText, 768);
}

/**
 * Synthesizes a conversational answer using Gemini 1.5 Flash grounded strictly in user notes.
 */
export async function generateRAGAnswer(
  query: string,
  notes: Array<{ id: string; title: string; plain_text: string }>
): Promise<string> {
  const notesContext = notes
    .map(
      (n, i) =>
        `[Note ${i + 1}: ${n.title}]\n${n.plain_text}\n`
    )
    .join("\n---\n\n");

  const prompt = `You are Second Brain AI, an intelligent personal knowledge assistant for Gustavo and Gianna.
Answer the user's question clearly, concisely, and conversationally based ONLY on their personal notes provided below.
Rules:
1. Ground your answer strictly in the provided notes. Do not fabricate facts.
2. Cite the note title using brackets like [Note: Title] whenever citing specific information.
3. If the provided notes do not contain the answer, politely state: "I couldn't find information regarding that in your Second Brain notes."
4. If multiple notes provide relevant context, synthesize them into a cohesive explanation.

User Question:
"${query}"

User's Notes Context:
${notesContext || "No relevant notes found."}
`;

  try {
    const client = getGenAIClient();
    const result = await client.models.generateContent({
      model: "gemini-1.5-flash",
      contents: prompt,
    });

    if (result.text) {
      return result.text;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      "[Vertex AI Gemini] Gemini API call deferred. Generating local synthesis:",
      message
    );
  }

  // Fallback synthesis when offline or ADC is unconfigured
  if (notes.length === 0) {
    return `I couldn't find information regarding that in your Second Brain notes.`;
  }

  const topNotes = notes.slice(0, 3);
  const citations = topNotes.map((n) => `[Note: "${n.title}"] (ID: ${n.id})`).join(", ");
  const summaries = topNotes
    .map((n) => `• From [Note: "${n.title}"]: ${n.plain_text.slice(0, 220)}...`)
    .join("\n\n");

  return `Based on your notes (${citations}):\n\n${summaries}`;
}

/**
 * Calculate cosine similarity between two normalized or raw float vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}
