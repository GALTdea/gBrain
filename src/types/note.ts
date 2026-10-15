import { JSONContent } from "@tiptap/react";

export interface Note {
  id: string;
  title: string;
  content: JSONContent; // Raw TipTap JSON representation for rich-text editing
  plain_text: string;   // Plain text extracted for vector search & embeddings
  tags?: string[];
  userId: string;
  createdAt: number;
  updatedAt: number;
}

