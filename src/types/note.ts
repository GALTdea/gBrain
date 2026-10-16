import { JSONContent } from "@tiptap/react";

export interface Note {
  id: string;
  title: string;
  content: JSONContent; // Raw TipTap JSON representation for rich-text editing
  plain_text: string;   // Plain text extracted for vector search & embeddings
  tags?: string[];
  embedding?: number[]; // 768-dimensional vector embedding from text-embedding-004
  audioUrl?: string;    // Firebase Storage HTTPS download URL for web playback
  audioStorageUri?: string; // gs:// URI for Vertex AI / multimodal processing
  userId: string;
  createdAt: number;
  updatedAt: number;
}

