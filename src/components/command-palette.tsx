"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SearchHit } from "@/lib/schema";
import { Modal, SwatchRow } from "./primitives";

const SUGGESTIONS = [
  "minimal glass dashboard",
  "warm editorial with heavy type",
  "something calm for a fintech landing page",
  "dense data-heavy interface",
  "Apple-style hero",
  "brutalist mono grid",
];

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQ("");
      setHits([]);
      setCursor(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    // Debounced: expansion costs a Haiku call, so don't fire per keystroke.
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q, limit: 12, expand: q.trim().length > 3 }),
        });
        const data = await res.json();
        if (!cancelled) {
          setHits(data.hits ?? []);
          setCursor(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, q ? 260 : 0);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, open]);

  const go = (slug: string) => {
    onClose();
    router.push(`/i/${slug}`);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, hits.length - 1));
    } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter" && hits[cursor]) {
      e.preventDefault();
      go(hits[cursor]!.slug);
    }
  };

  return (
    <Modal open={open} onClose={onClose} labelledBy="cmdk-label" size="lg">
      <span id="cmdk-label" className="sr-only">
        Search the design library
      </span>
      <div className="flex items-center gap-3 border-b border-rule px-5 py-4">
        <span className="label text-accent">Find</span>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Describe what you're looking for…"
          aria-label="Search"
          autoComplete="off"
          className="flex-1 bg-transparent text-base outline-none placeholder:text-ink-faint"
        />
        {loading && <span className="label anim-shimmer text-ink-faint">…</span>}
      </div>

      <div className="scrollbar-thin max-h-[60vh] overflow-auto">
        {hits.length === 0 && !loading && (
          <div className="px-5 py-6">
            {q ? (
              <>
                <p className="text-sm text-ink-muted">
                  Nothing matched <span className="font-mono">{q}</span>.
                </p>
                <p className="mt-2 text-sm text-ink-faint">
                  Search runs over how each design is described, not its copy —
                  try a mood, a technique, or a use case.
                </p>
              </>
            ) : (
              <p className="text-sm text-ink-muted">
                Search names, slugs, tags, components, colours, and the full
                written analysis. Natural language works.
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setQ(s)}
                  className="chip hover:border-ink hover:text-ink"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        <ul role="listbox" aria-label="Results">
          {hits.map((h, i) => (
            <li key={h.slug}>
              <button
                type="button"
                role="option"
                aria-selected={i === cursor}
                onMouseEnter={() => setCursor(i)}
                onClick={() => go(h.slug)}
                className={`flex w-full items-start gap-4 border-b border-rule px-5 py-3 text-left transition-colors duration-[120ms] ${
                  i === cursor ? "bg-paper-sunken" : ""
                }`}
              >
                <SwatchRow palette={h.palette.slice(0, 5)} size={12} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="display text-base">{h.name}</span>
                    <span className="font-mono text-2xs text-ink-faint">
                      {h.slug}
                    </span>
                    {h.humanVerified && (
                      <span className="label text-ok">verified</span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-2xs text-ink-muted">
                    {h.dna}
                  </span>
                  {h.matchedOn.length > 0 && (
                    <span className="mt-1 block truncate text-2xs text-ink-faint">
                      matched: {h.matchedOn.join(" · ")}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="label flex items-center justify-between border-t border-rule px-5 py-2.5 text-ink-faint">
        <span>↑↓ navigate · ↵ open · esc close</span>
        <span>{hits.length} results</span>
      </div>
    </Modal>
  );
}
