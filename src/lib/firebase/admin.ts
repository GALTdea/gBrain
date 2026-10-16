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
      ignoreUndefinedProperties: true,
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
 * Google Gen AI client configured for Gemini API Key (if provided) or Vertex AI backend.
 */
let genAIClient: GoogleGenAI | null = null;
export const getGenAIClient = (): GoogleGenAI => {
  if (!genAIClient) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (apiKey) {
      genAIClient = new GoogleGenAI({ apiKey });
      return genAIClient;
    }

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

export interface VoiceMemoAnalysis {
  title: string;
  summary: string;
  transcript: string;
  tags: string[];
}

export interface ProcessVoiceMemoParams {
  audioStorageUri?: string;
  audioBase64?: string;
  mimeType: string;
  browserTranscript?: string;
}

/**
 * Multimodal audio processing using Gemini 1.5 Flash via Vertex AI,
 * with live browser SpeechRecognition transcript fallback when billing/ADC is not active.
 */
export async function processMultimodalVoiceMemo(
  params: ProcessVoiceMemoParams
): Promise<VoiceMemoAnalysis> {
  const { audioStorageUri, audioBase64, mimeType, browserTranscript } = params;

  const promptText = `You are Second Brain AI's voice intelligence module for Gustavo and Gianna.
Listen carefully to the provided audio recording.${
    browserTranscript
      ? `\nInitial live speech recognition transcript for reference: "${browserTranscript}"`
      : ""
  }
1. Provide a clean, verbatim transcription of everything said in the recording.
2. Generate a concise high-level summary (1-3 sentences) capturing the core ideas or decisions.
3. Suggest a concise, informative title (3-7 words).
4. Suggest 2-5 relevant tags (always include "voice-memo").

You must return valid JSON with exactly these keys:
{
  "title": "string",
  "summary": "string",
  "transcript": "string",
  "tags": ["voice-memo", "tag1"]
}`;

  try {
    const client = getGenAIClient();
    const parts: Array<Record<string, unknown>> = [];

    if (audioStorageUri) {
      parts.push({
        fileData: {
          fileUri: audioStorageUri,
          mimeType: mimeType || "audio/webm",
        },
      });
    } else if (audioBase64) {
      const cleanBase64 = audioBase64.replace(/^data:audio\/[^;]+;base64,/, "");
      parts.push({
        inlineData: {
          mimeType: mimeType || "audio/webm",
          data: cleanBase64,
        },
      });
    }

    parts.push({ text: promptText });

    const result = await client.models.generateContent({
      model: "gemini-1.5-flash",
      contents: parts,
      config: {
        responseMimeType: "application/json",
        temperature: 0.2,
      },
    });

    if (result.text) {
      let jsonStr = result.text.trim();
      if (jsonStr.startsWith("```json")) {
        jsonStr = jsonStr.replace(/^```json/, "").replace(/```$/, "").trim();
      } else if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/^```/, "").replace(/```$/, "").trim();
      }

      const parsed = JSON.parse(jsonStr);
      return {
        title: parsed.title || "Voice Memo",
        summary: parsed.summary || "Voice recording summary",
        transcript: parsed.transcript || browserTranscript || "No transcript generated.",
        tags: Array.isArray(parsed.tags) ? parsed.tags : ["voice-memo"],
      };
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      "[Multimodal Voice] Gemini 1.5 Flash call deferred or offline:",
      message
    );
  }

  // If browser SpeechRecognition captured the spoken words, synthesize title, summary, and transcript directly!
  const cleanTranscript = (browserTranscript || "").trim();
  if (cleanTranscript) {
    const words = cleanTranscript.split(/\s+/);
    const titleWords = words.slice(0, 6).join(" ");
    const formattedTitle =
      titleWords.charAt(0).toUpperCase() +
      titleWords.slice(1) +
      (words.length > 6 ? "..." : "");

    const summaryText =
      cleanTranscript.length > 160
        ? `${cleanTranscript.slice(0, 157).trim()}...`
        : cleanTranscript;

    return {
      title: formattedTitle,
      summary: summaryText,
      transcript: cleanTranscript,
      tags: ["voice-memo", "audio"],
    };
  }

  // Graceful fallback if neither Vertex AI nor browser SpeechRecognition produced text
  const dateStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return {
    title: `Voice Memo (${dateStr})`,
    summary: "Voice recording captured via Second Brain VoiceRecorder.",
    transcript:
      "No speech detected during recording (or Vertex AI billing is disabled and browser speech recognition was unavailable).",
    tags: ["voice-memo", "audio"],
  };
}

/**
 * Formats voice memo summary and transcript into a TipTap document structure.
 */
export function formatVoiceTipTapDoc(summary: string, transcript: string, audioUrl?: string) {
  const content: Array<Record<string, unknown>> = [];

  if (audioUrl) {
    content.push({
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "🎵 Audio Recording: ",
          marks: [{ type: "bold" }],
        },
        {
          type: "text",
          text: "Play Audio File",
          marks: [{ type: "link", attrs: { href: audioUrl, target: "_blank" } }],
        },
      ],
    });
  }

  content.push(
    {
      type: "heading",
      attrs: { level: 3 },
      content: [{ type: "text", text: "Summary" }],
    },
    {
      type: "paragraph",
      content: [{ type: "text", text: summary }],
    },
    {
      type: "heading",
      attrs: { level: 3 },
      content: [{ type: "text", text: "Transcript" }],
    }
  );

  const paragraphs = transcript.split("\n\n").filter(Boolean);
  if (paragraphs.length > 0) {
    paragraphs.forEach((p) => {
      content.push({
        type: "paragraph",
        content: [{ type: "text", text: p }],
      });
    });
  } else {
    content.push({
      type: "paragraph",
      content: [{ type: "text", text: transcript || "No transcript available." }],
    });
  }

  return {
    type: "doc",
    content,
  };
}

