"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/* ---------------------------------------------------------------- */
/* Chip — the load-bearing primitive from the reference screenshots. */
/* ---------------------------------------------------------------- */

export function Chip({
  children,
  active = false,
  count,
  onClick,
  title,
  as = "span",
}: {
  children: ReactNode;
  active?: boolean;
  count?: number;
  onClick?: () => void;
  title?: string;
  as?: "span" | "button";
}) {
  const cls = `chip ${
    active
      ? "border-ink bg-ink text-paper"
      : onClick
        ? "hover:border-ink hover:text-ink"
        : ""
  }`;
  const body = (
    <>
      {children}
      {count !== undefined && (
        <span className={active ? "text-paper/70" : "text-accent"}>{count}</span>
      )}
    </>
  );
  if (as === "button" || onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        aria-pressed={onClick ? active : undefined}
        className={cls}
      >
        {body}
      </button>
    );
  }
  return (
    <span className={cls} title={title}>
      {body}
    </span>
  );
}

/* ---------------------------------------------------------------- */
/* Copy button — the affordance the brief asks for "everywhere".     */
/* ---------------------------------------------------------------- */

export function CopyButton({
  text,
  label = "Copy",
  slug,
  wide = false,
}: {
  text: string;
  label?: string;
  /** Copying a slug's artifact counts as a use — drives "most used". */
  slug?: string;
  wide?: boolean;
}) {
  const [state, setState] = useState<"idle" | "done" | "error">("idle");

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("done");
      if (slug) {
        void fetch(`/api/inspirations/${slug}/use`, { method: "POST" });
      }
    } catch {
      setState("error");
    }
    setTimeout(() => setState("idle"), 1600);
  }, [text, slug]);

  return (
    <button
      type="button"
      onClick={copy}
      className={`chip border-ink-muted hover:border-ink hover:text-ink ${
        wide ? "justify-center" : ""
      } ${state === "done" ? "border-ok! text-ok!" : ""}`}
      aria-live="polite"
    >
      {state === "done" ? "Copied" : state === "error" ? "Copy failed" : label}
    </button>
  );
}

/* ---------------------------------------------------------------- */
/* MonoPanel — the tinted prompt block from screenshot 02.           */
/* ---------------------------------------------------------------- */

export function MonoPanel({
  title,
  body,
  /** Substrings rendered as highlighted slots, e.g. bracketed placeholders. */
  highlight = true,
  maxHeight = "22rem",
}: {
  title?: string;
  body: string;
  highlight?: boolean;
  maxHeight?: string;
}) {
  return (
    <div className="border border-rule bg-paper-sunken">
      {title && (
        <div className="label border-b border-rule px-4 py-2 text-accent">
          {title}
        </div>
      )}
      <pre
        className="scrollbar-thin overflow-auto px-4 py-3 font-mono text-xs whitespace-pre-wrap text-ink-muted"
        style={{ maxHeight }}
      >
        {highlight ? highlightSlots(body) : body}
      </pre>
    </div>
  );
}

/** Bracketed placeholders read as fill-in slots, as in the reference. */
function highlightSlots(text: string): ReactNode[] {
  const parts = text.split(/(\[[^\]\n]{2,80}\])/g);
  return parts.map((part, i) =>
    part.startsWith("[") && part.endsWith("]") ? (
      <mark
        key={i}
        className="bg-accent-soft text-ink"
        style={{ padding: "0 2px" }}
      >
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

/* ---------------------------------------------------------------- */
/* Swatches                                                          */
/* ---------------------------------------------------------------- */

export function SwatchRow({
  palette,
  size = 14,
  onPick,
}: {
  palette: Array<{ hex: string; role: string; weight: number }>;
  size?: number;
  onPick?: (hex: string) => void;
}) {
  return (
    <div className="flex" role="list" aria-label="Extracted palette">
      {palette.map((s) => {
        const title = `${s.hex} — ${s.role} (${(s.weight * 100).toFixed(1)}%)`;
        const style = {
          background: s.hex,
          width: size,
          height: size,
          outline: "1px solid var(--rule)",
          outlineOffset: -1,
        };
        return onPick ? (
          <button
            key={`${s.hex}-${s.role}`}
            type="button"
            role="listitem"
            title={title}
            aria-label={`Filter by ${title}`}
            onClick={() => onPick(s.hex)}
            style={style}
          />
        ) : (
          <span
            key={`${s.hex}-${s.role}`}
            role="listitem"
            title={title}
            aria-label={title}
            style={style}
          />
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Modal — real focus trap, esc to close, restores focus on exit.    */
/* ---------------------------------------------------------------- */

export function Modal({
  open,
  onClose,
  labelledBy,
  children,
  size = "lg",
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: ReactNode;
  size?: "lg" | "full";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusables = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null);

    focusables()[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
      restoreTo.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="anim-veil absolute inset-0 bg-ink/35 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={`anim-slide-up relative flex max-h-[92vh] w-full flex-col border border-rule-strong bg-paper shadow-2xl ${
          size === "full" ? "sm:max-w-6xl" : "sm:max-w-3xl"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Toast — informs, then leaves. Never nags.                         */
/* ---------------------------------------------------------------- */

let pushToast: ((message: string, tone?: "info" | "bad") => void) | null = null;
export const toast = (message: string, tone: "info" | "bad" = "info") =>
  pushToast?.(message, tone);

export function Toaster() {
  const [items, setItems] = useState<
    Array<{ id: number; message: string; tone: "info" | "bad" }>
  >([]);

  useEffect(() => {
    pushToast = (message, tone = "info") => {
      const id = Date.now() + Math.random();
      setItems((prev) => [...prev.slice(-2), { id, message, tone }]);
      setTimeout(
        () => setItems((prev) => prev.filter((i) => i.id !== id)),
        tone === "bad" ? 6000 : 3000,
      );
    };
    return () => {
      pushToast = null;
    };
  }, []);

  return (
    <div
      className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {items.map((i) => (
        <div
          key={i.id}
          className={`anim-fade-up border px-4 py-2 font-mono text-xs shadow-lg ${
            i.tone === "bad"
              ? "border-bad bg-paper text-bad"
              : "border-ink bg-ink text-paper"
          }`}
        >
          {i.message}
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Skeleton — matches final layout so nothing shifts on load.        */
/* ---------------------------------------------------------------- */

export function CardSkeleton() {
  return (
    <div className="border border-rule bg-paper-raised">
      <div className="anim-shimmer aspect-[4/3] bg-paper-sunken" />
      <div className="space-y-3 p-4">
        <div className="anim-shimmer h-6 w-1/2 bg-paper-sunken" />
        <div className="flex gap-2">
          <div className="anim-shimmer h-5 w-24 bg-paper-sunken" />
          <div className="anim-shimmer h-5 w-20 bg-paper-sunken" />
        </div>
        <div className="anim-shimmer h-4 w-1/3 bg-paper-sunken" />
      </div>
    </div>
  );
}

/** Two-digit entry numbers, as in the reference grid ("01 / 28"). */
export const pad2 = (n: number) => String(n).padStart(2, "0");
