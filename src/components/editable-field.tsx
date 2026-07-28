"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Click to edit. Optimistic: the new value shows immediately and only reverts
 * if the save actually fails, so a correction never feels like a round trip.
 */
export function EditableField({
  value,
  onSave,
  multiline = false,
  inline = false,
  placeholder = "",
  edited = false,
}: {
  value: string;
  onSave: (value: string) => Promise<void> | void;
  multiline?: boolean;
  inline?: boolean;
  placeholder?: string;
  edited?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [shown, setShown] = useState(value);
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement>(null);

  useEffect(() => {
    setShown(value);
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing) {
      ref.current?.focus();
      if (ref.current instanceof HTMLTextAreaElement) {
        ref.current.setSelectionRange(draft.length, draft.length);
      }
    }
  }, [editing, draft.length]);

  const commit = async () => {
    setEditing(false);
    const next = draft.trim();
    if (next === shown) return;
    const previous = shown;
    setShown(next);
    try {
      await onSave(next);
    } catch {
      setShown(previous);
      setDraft(previous);
    }
  };

  const cancel = () => {
    setDraft(shown);
    setEditing(false);
  };

  if (editing) {
    const shared = {
      value: draft,
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) =>
        setDraft(e.target.value),
      onBlur: commit,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          cancel();
        } else if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void commit();
        }
      },
      className:
        "w-full resize-y border border-focus bg-paper-raised px-2 py-1 outline-none",
      placeholder,
    };
    return multiline ? (
      <textarea
        {...shared}
        ref={ref as React.Ref<HTMLTextAreaElement>}
        rows={Math.min(10, Math.max(2, draft.split("\n").length + 1))}
      />
    ) : (
      <input {...shared} ref={ref as React.Ref<HTMLInputElement>} />
    );
  }

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={() => setEditing(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setEditing(true);
        }
      }}
      title="Click to edit — your edit is sticky and outranks the AI text"
      className={`cursor-text rounded-[1px] hover:bg-paper-sunken ${
        inline ? "" : "block whitespace-pre-wrap"
      } ${!shown ? "text-ink-faint italic" : ""}`}
    >
      {shown || placeholder || "—"}
      {edited && (
        <span className="ml-1.5 align-super text-2xs text-accent" title="Edited by you">
          ◆
        </span>
      )}
    </span>
  );
}
