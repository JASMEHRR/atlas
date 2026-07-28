"use client";

import { useEffect, useState } from "react";
import type { MixRole } from "./schema";

/**
 * Selection state for the Mixboard, shared across routes without a provider.
 * A module-level set plus subscribers: smaller than a context, and it means a
 * card can toggle selection without every route wiring a provider.
 */

export type Selection = { slug: string; role: MixRole; detail: string };

const KEY = "atlas-mixboard";
let picks: Selection[] = [];
const listeners = new Set<() => void>();

function load(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) picks = JSON.parse(raw);
  } catch {
    picks = [];
  }
}
load();

function commit(next: Selection[]): void {
  picks = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(picks));
  } catch {
    /* private mode — selection just won't survive a reload */
  }
  for (const fn of listeners) fn();
}

export function useMixboard() {
  const [, force] = useState(0);
  // The server cannot know localStorage, so the first client render must
  // match the empty server render. Picks appear on the effect pass.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  return {
    hydrated,
    picks: hydrated ? picks : [],
    has: (slug: string) => hydrated && picks.some((p) => p.slug === slug),
    toggle: (slug: string, role: MixRole = "layout") =>
      commit(
        picks.some((p) => p.slug === slug)
          ? picks.filter((p) => p.slug !== slug)
          : [...picks, { slug, role, detail: "" }],
      ),
    setRole: (slug: string, role: MixRole) =>
      commit(picks.map((p) => (p.slug === slug ? { ...p, role } : p))),
    setDetail: (slug: string, detail: string) =>
      commit(picks.map((p) => (p.slug === slug ? { ...p, detail } : p))),
    remove: (slug: string) => commit(picks.filter((p) => p.slug !== slug)),
    clear: () => commit([]),
    reorder: (from: number, to: number) => {
      const next = [...picks];
      const [moved] = next.splice(from, 1);
      if (moved) next.splice(to, 0, moved);
      commit(next);
    },
    load: (next: Selection[]) => commit(next),
  };
}

/** Theme, kept in sync with the pre-paint script in layout.tsx. */
export function useTheme() {
  const [theme, setThemeState] = useState<"light" | "dark">("light");

  useEffect(() => {
    const stored = localStorage.getItem("atlas-theme") as "light" | "dark" | null;
    setThemeState(
      stored ??
        (window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"),
    );
  }, []);

  const setTheme = (next: "light" | "dark") => {
    setThemeState(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("atlas-theme", next);
  };

  return { theme, setTheme, toggle: () => setTheme(theme === "dark" ? "light" : "dark") };
}
