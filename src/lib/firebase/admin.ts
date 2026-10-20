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
    const location = process.env.VERTEX_AI_LOCATION || "us-central1";

    vertexAI = new VertexAI({
      project: project || "",
      location,
    });
  }
  return vertexAI;
};

export class SynthesisError extends Error {
  status: number;
  details?: unknown;
  constructor(message: string, status = 500, details?: unknown) {
    super(message);
    this.name = "SynthesisError";
    this.status = status;
    this.details = details;
  }
}

/**
 * Sanitizes note text and queries to prevent malformed characters, null bytes,
 * or control sequences from causing 400 Bad Request rejections in Gemini REST APIs.
 */
export function sanitizeTextForGemini(text: string): string {
  if (!text || typeof text !== "string") return "";
  return text
    // Strip null bytes and non-printable control characters (preserving newline, carriage return, and tab)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    // Normalize unicode to prevent decomposed or invalid surrogate sequences
    .normalize("NFC")
    .trim();
}

/**
 * Dedicated Vertex AI GoogleGenAI client initialized via ADC credentials.
 */
let vertexAIGenAIClient: GoogleGenAI | null = null;
export const getVertexAIGenAIClient = (): GoogleGenAI => {
  if (!vertexAIGenAIClient) {
    const project =
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    const location = process.env.VERTEX_AI_LOCATION || "us-central1";

    vertexAIGenAIClient = new GoogleGenAI({
      vertexai: true,
      project: project || undefined,
      location,
    });
  }
  return vertexAIGenAIClient;
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

    return getVertexAIGenAIClient();
  }
  return genAIClient;
};

/**
 * Candidate models supported across Gemini API versions and Vertex AI.
 */
export const CANDIDATE_GEMINI_MODELS = [
  process.env.GEMINI_MODEL,
  "gemini-2.5-flash",
  "gemini-3.5-flash",
  "gemini-flash-latest",
  "gemini-3.8-flash",
  "gemini-3.1-flash-lite",
  "gemini-flash-lite-latest",
  "gemini-1.5-flash",
].filter(Boolean) as string[];

/**
 * Fast-path direct REST caller for Gemini endpoints when GEMINI_API_KEY is provided.
 */
export async function callGeminiDirectRest(
  apiKey: string,
  prompt: string,
  systemInstruction?: string,
  preferredModel?: string
): Promise<{ text?: string; error?: string; status?: number }> {
  const candidateModels = preferredModel
    ? [preferredModel, ...CANDIDATE_GEMINI_MODELS.filter((m) => m !== preferredModel)]
    : CANDIDATE_GEMINI_MODELS;

  let lastStatus = 500;
  let lastErrorMsg = "Gemini Direct REST failed";

  for (const model of candidateModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const body: Record<string, unknown> = {
        contents: [{ parts: [{ text: prompt }] }],
      };
      if (systemInstruction) {
        body.systemInstruction = {
          parts: [{ text: systemInstruction }],
        };
      }

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      lastStatus = res.status;
      if (!res.ok) {
        const errorText = await res.text();
        lastErrorMsg = `HTTP ${res.status} for model ${model}: ${errorText}`;
        console.warn(`[Gemini Direct REST] ${lastErrorMsg}`);
        continue;
      }

      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        return { text };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastErrorMsg = `Request failed for model ${model}: ${msg}`;
      console.warn(`[Gemini Direct REST] ${lastErrorMsg}`);
    }
  }

  return { error: lastErrorMsg, status: lastStatus };
}

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
  const cleanText = sanitizeTextForGemini(text);
  if (!cleanText) {
    return new Array(768).fill(0);
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  // Direct REST fast-path for embedding with API key if available
  if (apiKey) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "models/gemini-embedding-001",
          content: { parts: [{ text: cleanText }] },
          outputDimensionality: 768,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const vals = data?.embedding?.values;
        if (vals && Array.isArray(vals) && vals.length === 768) {
          return vals;
        }
      } else {
        const errBody = await res.text();
        console.warn(`[Gemini Embed] Direct REST embedContent returned ${res.status}:`, errBody);
      }
    } catch (embedRestErr) {
      console.warn("[Gemini Embed] Direct REST embedContent failed, trying SDK:", embedRestErr);
    }
  }

  // Try Vertex AI with ADC (text-embedding-004)
  try {
    const client = getVertexAIGenAIClient();
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
 * Synthesizes a conversational answer using Gemini grounded strictly in user notes.
 */
export async function generateRAGAnswer(
  query: string,
  notes: Array<{ id: string; title: string; plain_text: string }>,
  customSystemInstruction?: string
): Promise<string> {
  if (notes.length === 0) {
    return `I couldn't find information regarding that in your Second Brain notes.`;
  }

  // Sanitize all inputs to protect against malformed characters or URLs
  const cleanQuery = sanitizeTextForGemini(query);
  const notesContext = notes
    .map((n, i) => {
      const cleanTitle = sanitizeTextForGemini(n.title || "Untitled Note");
      const cleanBody = sanitizeTextForGemini(n.plain_text || "");
      if (!cleanBody && !cleanTitle) return null;
      return `[Note ${i + 1}: ${cleanTitle}]\n${cleanBody}\n`;
    })
    .filter(Boolean)
    .join("\n---\n\n");

  const systemInstruction = sanitizeTextForGemini(
    customSystemInstruction ||
    "You are Second Brain AI, an intelligent personal knowledge assistant for Gustavo and Gianna.\n" +
      "Analyze ALL provided notes that match the topic. Synthesize a unified, structured answer addressing each aspect of the user's question (e.g., break down by person, family, church if asked). Group insights conceptually rather than listing notes one by one. Cite every claim with [Note: Title] whenever citing specific information.\n" +
      "Ground your answer strictly in the provided notes. Do not fabricate facts. If the provided notes do not contain the answer, politely state: \"I couldn't find information regarding that in your Second Brain notes.\""
  );

  const prompt = `User Question:
"${cleanQuery}"

User's Notes Context:
${notesContext || "No relevant notes found."}
`;

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  let lastError: unknown = null;
  let lastStatus = 500;

  // 1. Fast-path direct REST endpoint if GEMINI_API_KEY is present
  if (apiKey) {
    try {
      const directResult = await callGeminiDirectRest(apiKey, prompt, systemInstruction);
      if (directResult.text) {
        return directResult.text;
      }
      if (directResult.error) {
        lastError = new Error(directResult.error);
        if (directResult.status) lastStatus = directResult.status;
      }
    } catch (directErr) {
      lastError = directErr;
      console.error(
        "[generateRAGAnswer] Direct Gemini REST call failed:",
        directErr instanceof Error ? directErr.stack || directErr.message : directErr
      );
    }
  }

  // 2. Vertex AI with ADC (using GoogleGenAI with vertexai: true)
  try {
    const vertexClient = getVertexAIGenAIClient();
    for (const model of CANDIDATE_GEMINI_MODELS) {
      try {
        const result = await vertexClient.models.generateContent({
          model,
          contents: prompt,
          config: {
            systemInstruction,
          },
        });

        if (result.text) {
          return result.text;
        }
      } catch (modelErr: unknown) {
        lastError = modelErr;
        const msg = modelErr instanceof Error ? modelErr.message : String(modelErr);
        console.warn(`[generateRAGAnswer] Vertex model ${model} failed, trying next candidate:`, msg);
      }
    }
  } catch (vertexErr: unknown) {
    lastError = vertexErr;
    console.warn("[generateRAGAnswer] Vertex client failed:", vertexErr);
  }

  // 3. Fallback to AI Studio SDK if available
  if (apiKey) {
    try {
      const studioClient = new GoogleGenAI({ apiKey });
      for (const model of CANDIDATE_GEMINI_MODELS) {
        try {
          const result = await studioClient.models.generateContent({
            model,
            contents: prompt,
            config: {
              systemInstruction,
            },
          });
          if (result.text) {
            return result.text;
          }
        } catch (studioErr) {
          lastError = studioErr;
        }
      }
    } catch (studioInitErr) {
      lastError = studioInitErr;
    }
  }

  // Exact error logging
  const finalErrorMessage =
    lastError instanceof Error ? lastError.message : String(lastError || "Unknown synthesis failure");
  console.error("[generateRAGAnswer] Gemini synthesis failed completely:", {
    message: finalErrorMessage,
    status: lastStatus,
  });

  // DO NOT silently fall back to the deterministic template!
  // Throw a SynthesisError so the API route returns the exact error and HTTP status.
  throw new SynthesisError(finalErrorMessage, lastStatus, lastError);
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
  clientTimeZone?: string;
  sharedContext?: {
    title?: string;
    text?: string;
    url?: string;
  };
}

/**
 * Normalizes browser MediaRecorder MIME types (e.g., "audio/webm;codecs=opus" -> "audio/webm")
 * so Vertex AI / Gemini multimodal endpoints don't reject codec parameters.
 */
function normalizeAudioMimeType(rawMime?: string): string {
  if (!rawMime) return "audio/webm";
  const base = rawMime.split(";")[0].trim().toLowerCase();
  if (base === "audio/mp4" || base === "audio/x-m4a" || base === "audio/m4a") {
    return "audio/mp4";
  }
  if (base === "audio/mpeg" || base === "audio/mp3") {
    return "audio/mp3";
  }
  if (base === "audio/wav" || base === "audio/x-wav" || base === "audio/wave") {
    return "audio/wav";
  }
  if (base === "audio/ogg" || base === "application/ogg") {
    return "audio/ogg";
  }
  if (base === "audio/aac") {
    return "audio/aac";
  }
  return "audio/webm";
}

/**
 * Strips any "data:audio/...;codecs=...;base64," prefix safely.
 */
function extractCleanBase64(dataUrlOrBase64: string): string {
  const commaIdx = dataUrlOrBase64.indexOf(",");
  if (commaIdx !== -1 && dataUrlOrBase64.slice(0, commaIdx).includes("base64")) {
    return dataUrlOrBase64.slice(commaIdx + 1).trim();
  }
  return dataUrlOrBase64.replace(/^data:[^,]+,/, "").trim();
}

/**
 * Multimodal audio processing using Gemini via Vertex AI / GenAI SDK,
 * with clean base64 extraction and timezone-accurate fallback.
 */
export async function processMultimodalVoiceMemo(
  params: ProcessVoiceMemoParams
): Promise<VoiceMemoAnalysis> {
  const {
    audioStorageUri,
    audioBase64,
    mimeType,
    browserTranscript,
    clientTimeZone = "America/Los_Angeles",
    sharedContext,
  } = params;

  const cleanMimeType = normalizeAudioMimeType(mimeType);
  const cleanBase64 = audioBase64 ? extractCleanBase64(audioBase64) : undefined;

  let contextDescription = "";
  if (sharedContext?.url || sharedContext?.title || sharedContext?.text) {
    contextDescription = `\n[Reference Context from another app]:\n`;
    if (sharedContext.title) contextDescription += `- Title: ${sharedContext.title}\n`;
    if (sharedContext.url) contextDescription += `- URL: ${sharedContext.url}\n`;
    if (sharedContext.text) contextDescription += `- Snippet: ${sharedContext.text}\n`;
    contextDescription += `The user is speaking about this referenced content. Synthesize their thoughts in connection with it.\n`;
  }

  const promptText = `You are Second Brain AI's voice intelligence module for Gustavo and Gianna.
Listen carefully to the provided audio recording.${contextDescription}${
    browserTranscript
      ? `\nInitial live speech recognition transcript for reference: "${browserTranscript}"`
      : ""
  }
1. Provide a clean, verbatim transcription of everything said in the recording.
2. Generate a concise high-level summary (1-3 sentences) capturing the core ideas, decisions, or commentary on the referenced context.
3. Suggest a concise, informative title (3-7 words).
4. Suggest 2-5 relevant tags (always include "voice-memo").

You must return valid JSON with exactly these keys:
{
  "title": "string",
  "summary": "string",
  "transcript": "string",
  "tags": ["voice-memo", "tag1"]
}`;

  const parseJsonAnalysis = (rawText: string): VoiceMemoAnalysis | null => {
    try {
      let jsonStr = rawText.trim();
      if (jsonStr.startsWith("```json")) {
        jsonStr = jsonStr.replace(/^```json/, "").replace(/```$/, "").trim();
      } else if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/^```/, "").replace(/```$/, "").trim();
      }
      const parsed = JSON.parse(jsonStr);
      if (parsed && (parsed.transcript || parsed.summary)) {
        return {
          title: parsed.title || "Voice Memo",
          summary: parsed.summary || "Voice recording summary",
          transcript: parsed.transcript || browserTranscript || "No transcript generated.",
          tags: Array.isArray(parsed.tags) ? parsed.tags : ["voice-memo"],
        };
      }
    } catch (parseErr) {
      console.warn("[Multimodal Voice] Failed to parse JSON response:", parseErr);
    }
    return null;
  };

  // Strategy 1: GoogleGenAI SDK (prefer inlineData when cleanBase64 is present so GCS IAM never blocks)
  try {
    const client = getGenAIClient();
    const parts: Array<Record<string, unknown>> = [];

    if (cleanBase64) {
      parts.push({
        inlineData: {
          mimeType: cleanMimeType,
          data: cleanBase64,
        },
      });
    } else if (audioStorageUri) {
      parts.push({
        fileData: {
          fileUri: audioStorageUri,
          mimeType: cleanMimeType,
        },
      });
    }

    parts.push({ text: promptText });

    for (const model of CANDIDATE_GEMINI_MODELS) {
      try {
        const result = await client.models.generateContent({
          model,
          contents: [{ role: "user", parts }],
          config: {
            responseMimeType: "application/json",
            temperature: 0.2,
          },
        });
        if (result.text) {
          const parsed = parseJsonAnalysis(result.text);
          if (parsed) return parsed;
        }
      } catch (voiceModelErr) {
        console.warn(`[Multimodal Voice GenAI] Model ${model} failed, trying next:`, voiceModelErr);
      }
    }
  } catch (err: unknown) {
    console.warn("[Multimodal Voice] GenAI client error:", err);
  }

  // Strategy 2: Official @google-cloud/vertexai SDK fallback (guaranteed ADC compatibility on Cloud Run)
  if (cleanBase64) {
    try {
      const vertex = getVertexAI();
      for (const modelName of ["gemini-2.5-flash", "gemini-1.5-flash", "gemini-2.0-flash-001"]) {
        try {
          const generativeModel = vertex.getGenerativeModel({
            model: modelName,
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.2,
            },
          });
          const resp = await generativeModel.generateContent({
            contents: [
              {
                role: "user",
                parts: [
                  {
                    inlineData: {
                      mimeType: cleanMimeType,
                      data: cleanBase64,
                    },
                  },
                  { text: promptText },
                ],
              },
            ],
          });
          const candidateText =
            resp.response?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (candidateText) {
            const parsed = parseJsonAnalysis(candidateText);
            if (parsed) return parsed;
          }
        } catch (vertexModelErr) {
          console.warn(`[Multimodal Voice VertexAI] Model ${modelName} failed:`, vertexModelErr);
        }
      }
    } catch (vertexErr) {
      console.warn("[Multimodal Voice] VertexAI fallback error:", vertexErr);
    }
  }

  // Strategy 3: If browser SpeechRecognition captured the spoken words, synthesize directly
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

  // Graceful fallback with accurate user timezone (defaulting to America/Los_Angeles instead of server UTC)
  let dateStr: string;
  try {
    dateStr = new Date().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: clientTimeZone || "America/Los_Angeles",
    });
  } catch {
    dateStr = new Date().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Los_Angeles",
    });
  }

  return {
    title: `Voice Memo (${dateStr})`,
    summary: "Voice recording captured via Second Brain VoiceRecorder.",
    transcript:
      "No speech detected during recording (or Vertex AI multimodal analysis was unreachable).",
    tags: ["voice-memo", "audio"],
  };
}

export function formatVoiceTipTapDoc(
  summary: string,
  transcript: string,
  audioUrl?: string,
  sharedContext?: { title?: string; text?: string; url?: string }
) {
  const content: Array<Record<string, unknown>> = [];

  if (sharedContext?.url) {
    content.push({
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "🔗 Referenced Link: ",
          marks: [{ type: "bold" }],
        },
        {
          type: "text",
          text: sharedContext.title || sharedContext.url,
          marks: [{ type: "link", attrs: { href: sharedContext.url, target: "_blank" } }],
        },
      ],
    });
  }

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

