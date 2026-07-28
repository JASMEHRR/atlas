"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useMixboard, useTheme } from "@/lib/store";
import { CommandPalette } from "./command-palette";
import { JobsDock } from "./jobs-dock";
import { Modal } from "./primitives";

const NAV = [
  { href: "/", label: "Library" },
  { href: "/mix", label: "Mixboard" },
  { href: "/collections", label: "Collections" },
  { href: "/compare", label: "Compare" },
  { href: "/settings", label: "Export" },
];

const SHORTCUTS: Array<[string, string]> = [
  ["⌘K / Ctrl K", "Open the command palette"],
  ["/", "Focus search"],
  ["j / k", "Move down / up the grid"],
  ["Enter", "Open the focused entry"],
  ["c", "Copy the focused entry's Claude prompt"],
  ["x", "Add or remove the focused entry from the Mixboard"],
  ["g then l", "Go to Library"],
  ["g then m", "Go to Mixboard"],
  ["Esc", "Close whatever is open"],
  ["?", "This sheet"],
];

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const { picks } = useMixboard();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    let pendingG = false;
    let gTimer: ReturnType<typeof setTimeout>;

    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        el?.tagName === "INPUT" ||
        el?.tagName === "TEXTAREA" ||
        el?.isContentEditable === true;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (typing) return;

      if (e.key === "?") {
        e.preventDefault();
        setHelpOpen(true);
        return;
      }
      // g-then-letter, the standard two-key nav chord.
      if (e.key === "g") {
        pendingG = true;
        clearTimeout(gTimer);
        gTimer = setTimeout(() => (pendingG = false), 900);
        return;
      }
      if (pendingG) {
        pendingG = false;
        const target = { l: "/", m: "/mix", c: "/collections", e: "/settings" }[
          e.key
        ];
        if (target) {
          e.preventDefault();
          window.location.href = target;
        }
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:border focus:border-ink focus:bg-paper focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-30 border-b border-rule bg-paper/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-6 px-5">
          <Link href="/" className="display text-lg tracking-tight">
            Atlas
          </Link>

          <nav aria-label="Main" className="hidden items-center gap-1 sm:flex">
            {NAV.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`label px-3 py-2 transition-colors duration-[120ms] ${
                    active
                      ? "text-accent"
                      : "text-ink-muted hover:text-ink"
                  }`}
                >
                  {item.label}
                  {item.href === "/mix" && picks.length > 0 && (
                    <span className="ml-1.5 text-accent">{picks.length}</span>
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="chip hover:border-ink hover:text-ink"
              aria-label="Open command palette"
            >
              Search
              <kbd className="ml-1 text-ink-faint">⌘K</kbd>
            </button>
            <button
              type="button"
              onClick={toggle}
              className="chip hover:border-ink hover:text-ink"
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            >
              {theme === "dark" ? "Light" : "Dark"}
            </button>
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="chip hover:border-ink hover:text-ink"
              aria-label="Keyboard shortcuts"
            >
              ?
            </button>
          </div>
        </div>
      </header>

      <main id="main" className="flex-1">
        {children}
      </main>

      <JobsDock />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

      <Modal open={helpOpen} onClose={() => setHelpOpen(false)} labelledBy="sk">
        <div className="flex items-center justify-between border-b border-rule px-6 py-4">
          <h2 id="sk" className="display text-xl">
            Keyboard
          </h2>
          <button
            type="button"
            onClick={() => setHelpOpen(false)}
            className="chip hover:border-ink hover:text-ink"
          >
            Close
          </button>
        </div>
        <dl className="divide-y divide-rule overflow-auto">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={keys} className="flex items-center gap-4 px-6 py-3">
              <dt className="w-40 shrink-0 font-mono text-xs text-accent">
                {keys}
              </dt>
              <dd className="text-sm text-ink-muted">{what}</dd>
            </div>
          ))}
        </dl>
      </Modal>
    </div>
  );
}
