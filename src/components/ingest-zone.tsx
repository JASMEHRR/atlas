"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "./primitives";

type Item =
  | { kind: "image"; data: string; filename: string | null }
  | { kind: "url"; url: string };

const toBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });

/** Drop, paste, or URL. All three land in the same staged pipeline. */
export function IngestZone({ onDone }: { onDone: () => void }) {
  const [dragging, setDragging] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const depth = useRef(0);

  const submit = useCallback(
    async (items: Item[]) => {
      if (items.length === 0) return;
      setBusy(true);
      try {
        const res = await fetch("/api/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "Ingest failed");
        toast(
          `Queued ${items.length} ${items.length === 1 ? "capture" : "captures"} — watch the pipeline`,
        );
        onDone();
      } catch (err) {
        toast(err instanceof Error ? err.message : "Ingest failed", "bad");
      } finally {
        setBusy(false);
      }
    },
    [onDone],
  );

  const fromFiles = useCallback(
    async (files: FileList | File[]) => {
      const images = Array.from(files).filter((f) => f.type.startsWith("image/"));
      if (images.length === 0) {
        toast("Those weren't images.", "bad");
        return;
      }
      await submit(
        await Promise.all(
          images.map(async (f) => ({
            kind: "image" as const,
            data: await toBase64(f),
            filename: f.name,
          })),
        ),
      );
    },
    [submit],
  );

  /* Whole-page drop target — dropping in the corner shouldn't be a miss. */
  useEffect(() => {
    const onEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      depth.current++;
      setDragging(true);
    };
    const onLeave = () => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const onOver = (e: DragEvent) => e.preventDefault();
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      if (e.dataTransfer?.files.length) void fromFiles(e.dataTransfer.files);
    };
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.tagName === "INPUT" || el?.tagName === "TEXTAREA") return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) {
        e.preventDefault();
        void fromFiles(files);
      }
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("paste", onPaste);
    };
  }, [fromFiles]);

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-3 border border-dashed border-rule-strong px-4 py-3">
        <span className="label text-ink-faint">Add</span>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="chip hover:border-ink hover:text-ink disabled:opacity-50"
        >
          Choose screenshots
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          onChange={(e) => {
            if (e.target.files?.length) void fromFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <span className="text-2xs text-ink-faint">
          or drop anywhere · or paste from the clipboard
        </span>

        <form
          className="ml-auto flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!url.trim()) return;
            void submit([{ kind: "url", url: url.trim() }]);
            setUrl("");
          }}
        >
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            type="url"
            placeholder="https://…"
            aria-label="Capture a URL"
            className="w-56 border border-rule bg-transparent px-3 py-1.5 font-mono text-xs outline-none placeholder:text-ink-faint"
          />
          <button
            type="submit"
            disabled={busy || !url.trim()}
            className="chip hover:border-ink hover:text-ink disabled:opacity-50"
          >
            Capture
          </button>
        </form>
      </div>

      {dragging && (
        <div
          className="anim-veil pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-paper/90"
          aria-hidden="true"
        >
          <div className="border-2 border-dashed border-accent px-16 py-12 text-center">
            <p className="display text-3xl">Drop to analyse</p>
            <p className="label mt-3 text-ink-muted">
              PNG · JPG · WebP · several at once
            </p>
          </div>
        </div>
      )}
    </>
  );
}
