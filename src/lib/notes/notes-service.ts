import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  getDocs,
} from "firebase/firestore";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import { Note } from "@/types/note";

const DEMO_STORAGE_PREFIX = "gbrain_demo_notes_";

/**
 * Helper to get local demo notes when running offline or in demo mode
 */
function getLocalDemoNotes(userId: string): Note[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(`${DEMO_STORAGE_PREFIX}${userId}`);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error("Failed to read local demo notes:", err);
    return [];
  }
}

function saveLocalDemoNotes(userId: string, notes: Note[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(`${DEMO_STORAGE_PREFIX}${userId}`, JSON.stringify(notes));
  } catch (err) {
    console.error("Failed to save local demo notes:", err);
  }
}

/**
 * Subscribes to real-time updates for notes in the user's isolated subcollection:
 * users/{userId}/notes
 */
export function subscribeToUserNotes(
  userId: string,
  onNotes: (notes: Note[]) => void,
  onError?: (error: Error) => void
): () => void {
  if (!userId) {
    onNotes([]);
    return () => {};
  }

  // Fallback to local storage if Firebase is unconfigured or demo user is active
  if (!db || !isFirebaseConfigured || userId.startsWith("usr_")) {
    const notes = getLocalDemoNotes(userId);
    // Sort descending by updatedAt
    notes.sort((a, b) => b.updatedAt - a.updatedAt);
    onNotes(notes);

    // Set up a storage listener for cross-tab or in-page events
    const handleStorage = () => {
      const updated = getLocalDemoNotes(userId);
      updated.sort((a, b) => b.updatedAt - a.updatedAt);
      onNotes(updated);
    };

    window.addEventListener("gbrain-notes-updated", handleStorage);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener("gbrain-notes-updated", handleStorage);
      window.removeEventListener("storage", handleStorage);
    };
  }

  // Real Firestore subscription scoped to users/{userId}/notes
  try {
    const notesRef = collection(db, "users", userId, "notes");
    const q = query(notesRef, orderBy("updatedAt", "desc"));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const notes: Note[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            title: data.title || "Untitled Note",
            content: data.content || {},
            plain_text: data.plain_text || "",
            tags: data.tags || [],
            userId: data.userId || userId,
            createdAt: data.createdAt || Date.now(),
            updatedAt: data.updatedAt || Date.now(),
          };
        });
        onNotes(notes);
      },
      (error) => {
        console.error("Error subscribing to notes:", error);
        if (onError) onError(error);
      }
    );

    return unsubscribe;
  } catch (err: any) {
    console.error("Firestore subscription failure:", err);
    if (onError) onError(err);
    return () => {};
  }
}

/**
 * Creates or updates a note in users/{userId}/notes
 */
export async function saveNote(
  userId: string,
  note: {
    id: string;
    title: string;
    content: any;
    plain_text: string;
    tags?: string[];
    createdAt?: number;
  }
): Promise<Note> {
  if (!userId) {
    throw new Error("Cannot save note: User ID is required");
  }

  const now = Date.now();
  const fullNote: Note = {
    id: note.id,
    title: note.title.trim() || "Untitled Note",
    content: note.content,
    plain_text: note.plain_text,
    tags: note.tags || [],
    userId,
    createdAt: note.createdAt || now,
    updatedAt: now,
  };

  if (!db || !isFirebaseConfigured || userId.startsWith("usr_")) {
    const existing = getLocalDemoNotes(userId);
    const index = existing.findIndex((n) => n.id === note.id);
    if (index >= 0) {
      existing[index] = fullNote;
    } else {
      existing.unshift(fullNote);
    }
    saveLocalDemoNotes(userId, existing);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("gbrain-notes-updated"));
    }
    return fullNote;
  }

  // Firestore Write to users/{userId}/notes/{noteId}
  const noteRef = doc(db, "users", userId, "notes", note.id);
  await setDoc(noteRef, fullNote, { merge: true });
  return fullNote;
}

/**
 * Deletes a note from users/{userId}/notes
 */
export async function deleteNote(userId: string, noteId: string): Promise<void> {
  if (!userId || !noteId) return;

  if (!db || !isFirebaseConfigured || userId.startsWith("usr_")) {
    const existing = getLocalDemoNotes(userId);
    const filtered = existing.filter((n) => n.id !== noteId);
    saveLocalDemoNotes(userId, filtered);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("gbrain-notes-updated"));
    }
    return;
  }

  const noteRef = doc(db, "users", userId, "notes", noteId);
  await deleteDoc(noteRef);
}
