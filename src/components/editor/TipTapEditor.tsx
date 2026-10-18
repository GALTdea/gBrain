"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Note } from "@/types/note";
import { saveNote } from "@/lib/notes/notes-service";

interface TipTapEditorProps {
  initialNote?: Note | null;
  userId: string;
  onClose: () => void;
  onSaveSuccess?: (note: Note) => void;
}

export default function TipTapEditor({
  initialNote,
  userId,
  onClose,
  onSaveSuccess,
}: TipTapEditorProps) {
  const [noteId] = useState<string>(
    () => initialNote?.id || `note_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
  );
  const [title, setTitle] = useState<string>(initialNote?.title || "");
  const [tags, setTags] = useState<string[]>(initialNote?.tags || []);
  const [tagInput, setTagInput] = useState<string>("");
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved" | "error">(
    initialNote ? "saved" : "unsaved"
  );
  const [lastSaved, setLastSaved] = useState<Date | null>(
    initialNote ? new Date(initialNote.updatedAt) : null
  );

  const [hasSelection, setHasSelection] = useState<boolean>(false);
  const [showToolbar, setShowToolbar] = useState<boolean>(false);

  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const lastSavedPlainTextRef = useRef<string | undefined>(initialNote?.plain_text);

  // Initialize TipTap editor
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit],
    content: initialNote?.content || "",
    editorProps: {
      attributes: {
        class: "tiptap focus:outline-none min-h-[300px] px-4 py-3 text-base-content/90 leading-relaxed",
      },
    },
    onSelectionUpdate: ({ editor }) => {
      const { empty } = editor.state.selection;
      setHasSelection(!empty);
    },
    onUpdate: () => {
      triggerDebouncedSave();
    },
  });

  // Perform actual save operation to users/{userId}/notes
  const performSave = useCallback(
    async (currentTitle?: string, currentTags?: string[]) => {
      if (!editor || !userId) return;

      const rawJson = editor.getJSON();
      const plainText = editor.getText();
      const activeTitle = currentTitle !== undefined ? currentTitle : title;
      const activeTags = currentTags !== undefined ? currentTags : tags;

      // Automatically infer title from first line if left blank
      let finalTitle = activeTitle.trim();
      if (!finalTitle) {
        finalTitle = plainText.split("\n")[0]?.trim() || "Untitled Note";
      }

      try {
        setSaveStatus("saving");
        const prevPlainText = lastSavedPlainTextRef.current;
        const saved = await saveNote(
          userId,
          {
            id: noteId,
            title: finalTitle,
            content: rawJson,
            plain_text: plainText,
            tags: activeTags,
            createdAt: initialNote?.createdAt,
            embedding: initialNote?.embedding,
          },
          prevPlainText
        );

        lastSavedPlainTextRef.current = plainText;

        if (isMountedRef.current) {
          setSaveStatus("saved");
          setLastSaved(new Date());
          if (onSaveSuccess) {
            onSaveSuccess(saved);
          }
        }
      } catch (err) {
        console.error("Auto-save failed:", err);
        if (isMountedRef.current) {
          setSaveStatus("error");
        }
      }
    },
    [editor, userId, noteId, title, tags, initialNote, onSaveSuccess]
  );

  // Debounced auto-save handler (800ms)
  const triggerDebouncedSave = useCallback(() => {
    setSaveStatus("unsaved");
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      performSave();
    }, 800);
  }, [performSave]);

  // Handle title changes with auto-save
  const handleTitleChange = (newTitle: string) => {
    setTitle(newTitle);
    setSaveStatus("unsaved");
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      performSave(newTitle, tags);
    }, 800);
  };

  // Tag management
  const handleAddTag = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && tagInput.trim()) {
      e.preventDefault();
      const cleanTag = tagInput.trim().toLowerCase().replace(/^#/, "");
      if (!tags.includes(cleanTag)) {
        const nextTags = [...tags, cleanTag];
        setTags(nextTags);
        setTagInput("");
        performSave(title, nextTags);
      } else {
        setTagInput("");
      }
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    const nextTags = tags.filter((t) => t !== tagToRemove);
    setTags(nextTags);
    performSave(title, nextTags);
  };

  // Cleanup timers on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  if (!editor) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <span className="loading loading-spinner loading-md text-primary"></span>
      </div>
    );
  }

  return (
    <div className="card bg-base-200/50 backdrop-blur border border-base-300 shadow-2xl overflow-hidden transition-all">
      {/* Top Header Bar */}
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-base-300/60 bg-base-200/40">
        <button
          type="button"
          onClick={() => {
            if (saveTimerRef.current) {
              clearTimeout(saveTimerRef.current);
              performSave();
            }
            onClose();
          }}
          className="btn btn-ghost btn-sm gap-1.5 text-base-content/70 hover:text-base-content -ml-2"
          title="Back to notes"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          <span className="text-xs font-medium">Notes</span>
        </button>

        {/* Subtle Saving Indicator */}
        <div className="flex items-center gap-2">
          {saveStatus === "saving" && (
            <div className="flex items-center gap-1.5 text-primary/80 animate-pulse">
              <span className="loading loading-spinner loading-xs"></span>
              <span className="text-[11px] font-mono">Saving...</span>
            </div>
          )}
          {saveStatus === "saved" && (
            <div
              className="flex items-center gap-1 text-success/80"
              title={lastSaved ? `Last saved at ${lastSaved.toLocaleTimeString()}` : "Saved"}
            >
              <svg className="w-3.5 h-3.5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-[11px] font-mono text-base-content/50">Saved</span>
            </div>
          )}
          {saveStatus === "error" && (
            <div className="flex items-center gap-1 text-error text-[11px]">
              Failed to save
            </div>
          )}
        </div>
      </div>

      {/* Note Title Input */}
      <div className="px-6 pt-5 pb-2">
        <input
          type="text"
          placeholder="Note Title (or auto-derive from content)..."
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          className="w-full bg-transparent text-2xl font-bold tracking-tight placeholder:text-base-content/30 focus:outline-none"
        />
      </div>

      {/* Tags Input & Format toggle */}
      <div className="px-6 pb-3 flex flex-wrap items-center justify-between gap-2 border-b border-base-300/40">
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="badge badge-neutral badge-sm gap-1 py-2 px-2.5 text-xs font-mono"
            >
              #{tag}
              <button
                type="button"
                onClick={() => handleRemoveTag(tag)}
                className="hover:text-error ml-0.5"
              >
                ×
              </button>
            </span>
          ))}
          <input
            type="text"
            placeholder="+ Add tag..."
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={handleAddTag}
            className="input input-ghost input-xs max-w-[130px] text-xs focus:bg-base-300/40"
          />
        </div>

        {/* Subtle toggle for formatting toolbar if not highlighting text */}
        <button
          type="button"
          onClick={() => setShowToolbar((prev) => !prev)}
          className={`btn btn-ghost btn-xs rounded-lg gap-1 text-xs ${
            showToolbar || hasSelection ? "text-primary bg-primary/10" : "text-base-content/40 hover:text-base-content"
          }`}
          title={showToolbar ? "Hide formatting" : "Show formatting"}
        >
          <span className="font-serif font-bold text-xs">Aa</span>
          <span className="text-[10px] hidden sm:inline">{showToolbar || hasSelection ? "Hide formatting" : "Format"}</span>
        </button>
      </div>

      {/* TipTap Rich Text Toolbar (hidden unless text highlighted or formatting toggled) */}
      {(hasSelection || showToolbar) && (
        <div className="flex flex-wrap items-center gap-1 px-5 py-2 bg-base-200/90 border-b border-base-300/60 shadow-inner backdrop-blur animate-in fade-in slide-in-from-top-1 duration-150">
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={`btn btn-xs rounded-lg ${editor.isActive("bold") ? "btn-primary" : "btn-ghost"}`}
            title="Bold"
          >
            <strong>B</strong>
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`btn btn-xs rounded-lg ${editor.isActive("italic") ? "btn-primary" : "btn-ghost"}`}
            title="Italic"
          >
            <em>I</em>
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleStrike().run()}
            className={`btn btn-xs rounded-lg ${editor.isActive("strike") ? "btn-primary" : "btn-ghost"}`}
            title="Strikethrough"
          >
            <s>S</s>
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleCode().run()}
            className={`btn btn-xs rounded-lg font-mono ${editor.isActive("code") ? "btn-primary" : "btn-ghost"}`}
            title="Inline Code"
          >
            &lt;/&gt;
          </button>

          <div className="divider divider-horizontal my-1 mx-0.5"></div>

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            className={`btn btn-xs rounded-lg ${editor.isActive("heading", { level: 1 }) ? "btn-primary" : "btn-ghost"}`}
            title="Heading 1"
          >
            H1
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            className={`btn btn-xs rounded-lg ${editor.isActive("heading", { level: 2 }) ? "btn-primary" : "btn-ghost"}`}
            title="Heading 2"
          >
            H2
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            className={`btn btn-xs rounded-lg ${editor.isActive("heading", { level: 3 }) ? "btn-primary" : "btn-ghost"}`}
            title="Heading 3"
          >
            H3
          </button>

          <div className="divider divider-horizontal my-1 mx-0.5"></div>

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={`btn btn-xs rounded-lg ${editor.isActive("bulletList") ? "btn-primary" : "btn-ghost"}`}
            title="Bullet List"
          >
            • List
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={`btn btn-xs rounded-lg ${editor.isActive("orderedList") ? "btn-primary" : "btn-ghost"}`}
            title="Numbered List"
          >
            1. List
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            className={`btn btn-xs rounded-lg ${editor.isActive("blockquote") ? "btn-primary" : "btn-ghost"}`}
            title="Blockquote"
          >
            &ldquo; Quote
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            className={`btn btn-xs rounded-lg ${editor.isActive("codeBlock") ? "btn-primary" : "btn-ghost"}`}
            title="Code Block"
          >
            Code
          </button>

          <div className="divider divider-horizontal my-1 mx-0.5"></div>

          <button
            type="button"
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
            className="btn btn-xs btn-ghost rounded-lg"
            title="Undo"
          >
            ↩
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
            className="btn btn-xs btn-ghost rounded-lg"
            title="Redo"
          >
            ↪
          </button>
        </div>
      )}

      {/* Editor Content Area */}
      <div className="bg-base-100/40 p-4 min-h-[350px]">
        <EditorContent editor={editor} />
      </div>

      {/* Bottom Info Bar */}
      <div className="flex items-center justify-between text-xs text-base-content/40 px-6 py-2.5 bg-base-200/40 border-t border-base-300/50 font-mono">
        <div>
          {editor.getText().length} characters • {editor.getText().trim() ? editor.getText().trim().split(/\s+/).length : 0} words
        </div>
      </div>
    </div>
  );
}

