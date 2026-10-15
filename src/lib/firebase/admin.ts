import { Firestore } from "@google-cloud/firestore";
import { VertexAI } from "@google-cloud/vertexai";

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

/**
 * Server-side Vertex AI initialization using Application Default Credentials (ADC).
 * Configured for Gemini 1.5 Flash and text-embedding-004.
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

