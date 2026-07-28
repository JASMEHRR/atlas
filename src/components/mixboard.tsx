"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  MixRole,
  type ComposedPrompt,
  type OutputMode,
  type Recipe,
} from "@/lib/schema";
import { useMixboard } from "@/lib/store";
import { Chip, CopyButton, MonoPanel, toast } from "./primitives";

const ROLES = MixRole.options;
const MODES: Array<{ value: OutputMode; label: string; hint: string }> = [
  { value: "full-page", label: "Full page", hint: "Build a whole page in this language" },
  { value: "component", label: "Single component", hint: "One content-agnostic component" },
  { value: "restyle", label: "Restyle my code", hint: "Change the look, keep the behaviour" },
];

const SEVERITY = {
  incompatible: { label: "incompatible", cls: "border-bad text-bad" },
  warning: { label: "needs care", cls: "border-warn text-warn" },
  note: { label: "minor", cls: "border-rule-strong text-ink-muted" },
} as const;

export function Mixboard() {
  const mix = useMixboard();
  const [mode, setMode] = useState<OutputMode>("full-page");
  const [intent, setIntent] = useState("");
  const [result, setResult] = useState<ComposedPrompt | null>(null);
  const [loading, setLoading] = useState(false);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [recipeName, setRecipeName] = useState("");

  const loadRecipes = useCallback(async () => {
    const res = await fetch("/api/recipes");
    setRecipes((await res.json()).recipes ?? []);
  }, []);
  useEffect(() => void loadRecipes(), [loadRecipes]);

  const compose = useCallback(async () => {
    if (mix.picks.length === 0) return;
    setLoading(true);
    try {
      const res = await fetch("/api/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ picks: mix.picks, mode, intent }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Compose failed");
      setResult(json);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Compose failed", "bad");
    } finally {
      setLoading(false);
    }
  }, [mix.picks, mode, intent]);

  // Recompose whenever the board changes — the prompt is the primary view.
  useEffect(() => {
    if (mix.picks.length === 0) {
      setResult(null);
      return;
    }
    const t = setTimeout(compose, 180);
    return () => clearTimeout(t);
  }, [compose, mix.picks.length]);

  const saveRecipe = async () => {
    if (!recipeName.trim()) return;
    const res = await fetch("/api/recipes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: recipeName.trim(),
        request: { picks: mix.picks, mode, intent },
      }),
    });
    if (res.ok) {
      const { recipe } = await res.json();
      toast(`Saved "${recipe.name}" v${recipe.version}`);
      setRecipeName("");
      void loadRecipes();
    } else {
      toast("Could not save that recipe.", "bad");
    }
  };

  const download = () => {
    if (!result) return;
    const blob = new Blob([result.prompt], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `atlas-${mode}-${mix.picks.map((p) => p.slug).join("-").slice(0, 60)}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="mx-auto max-w-[1600px] px-5 py-6">
      <header className="flex flex-wrap items-baseline gap-4">
        <h1 className="display text-2xl">Mixboard</h1>
        <p className="max-w-2xl text-sm text-ink-muted">
          Give each reference a role. Atlas composes one coherent prompt, and
          reconciles anything that clashes rather than concatenating the briefs.
        </p>
      </header>

      {!mix.hydrated ? (
        // The board lives in localStorage; don't flash "nothing here" at a
        // user who has picks, in the one frame before hydration.
        <div className="anim-shimmer mt-6 h-64 border border-rule bg-paper-sunken" />
      ) : mix.picks.length === 0 ? (
        <div className="mt-6 border border-rule bg-paper-raised px-8 py-14 text-center">
          <p className="display text-2xl">Nothing on the board</p>
          <p className="mx-auto mt-3 max-w-lg text-sm text-ink-muted">
            Add references from the library — hover a card and hit{" "}
            <span className="font-mono text-accent">Mix</span>, or press{" "}
            <kbd className="font-mono text-accent">x</kbd> on the focused card.
            Two or three is usually the sweet spot: a palette, a layout, and a
            motion language.
          </p>
          <Link href="/" className="chip mt-5 border-ink hover:bg-ink hover:text-paper">
            Browse the library
          </Link>
          {recipes.length > 0 && (
            <div className="mt-8">
              <p className="label mb-3 text-ink-faint">Or reopen a recipe</p>
              <div className="flex flex-wrap justify-center gap-2">
                {recipes.map((r) => (
                  <Chip
                    key={r.id}
                    onClick={() => {
                      mix.load(r.request.picks);
                      setMode(r.request.mode);
                      setIntent(r.request.intent);
                    }}
                  >
                    {r.name} v{r.version}
                  </Chip>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,4fr)_minmax(0,6fr)]">
          {/* Board */}
          <div>
            <div className="flex items-center justify-between">
              <p className="label text-ink-faint">
                {mix.picks.length} on the board
              </p>
              <button
                type="button"
                onClick={() => mix.clear()}
                className="label text-ink-faint hover:text-bad"
              >
                Clear all
              </button>
            </div>

            <ul className="mt-2 space-y-2">
              {mix.picks.map((pick, index) => (
                <li key={pick.slug} className="border border-rule bg-paper-raised p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <Link
                      href={`/i/${pick.slug}`}
                      className="font-mono text-xs text-ink hover:text-accent"
                    >
                      {pick.slug}
                    </Link>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => mix.reorder(index, Math.max(0, index - 1))}
                        disabled={index === 0}
                        aria-label="Move up"
                        className="label px-1 text-ink-faint hover:text-ink disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          mix.reorder(index, Math.min(mix.picks.length - 1, index + 1))
                        }
                        disabled={index === mix.picks.length - 1}
                        aria-label="Move down"
                        className="label px-1 text-ink-faint hover:text-ink disabled:opacity-30"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => mix.remove(pick.slug)}
                        aria-label={`Remove ${pick.slug}`}
                        className="label px-1 text-ink-faint hover:text-bad"
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {ROLES.map((role) => (
                      <Chip
                        key={role}
                        active={pick.role === role}
                        onClick={() => mix.setRole(pick.slug, role)}
                      >
                        {role}
                      </Chip>
                    ))}
                  </div>

                  {(pick.role === "component" ||
                    pick.role === "navigation" ||
                    pick.role === "hero") && (
                    <input
                      value={pick.detail}
                      onChange={(e) => mix.setDetail(pick.slug, e.target.value)}
                      placeholder="which component? e.g. pricing-table"
                      aria-label={`Component detail for ${pick.slug}`}
                      className="mt-2 w-full border border-rule bg-transparent px-2 py-1 font-mono text-2xs outline-none placeholder:text-ink-faint"
                    />
                  )}
                </li>
              ))}
            </ul>

            <div className="mt-5">
              <p className="label mb-2 text-ink-faint">Output</p>
              <div className="space-y-1.5">
                {MODES.map((m) => (
                  <label
                    key={m.value}
                    className={`flex cursor-pointer items-start gap-3 border px-3 py-2 transition-colors duration-[120ms] ${
                      mode === m.value
                        ? "border-ink bg-paper-sunken"
                        : "border-rule hover:border-rule-strong"
                    }`}
                  >
                    <input
                      type="radio"
                      name="mode"
                      checked={mode === m.value}
                      onChange={() => setMode(m.value)}
                      className="mt-1 accent-[var(--accent)]"
                    />
                    <span>
                      <span className="block text-sm">{m.label}</span>
                      <span className="block text-2xs text-ink-faint">{m.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-4">
              <label htmlFor="intent" className="label mb-1.5 block text-ink-faint">
                What are you building?
              </label>
              <textarea
                id="intent"
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                rows={3}
                placeholder="A pricing page for a developer tool. Three tiers, annual toggle."
                className="w-full resize-y border border-rule bg-transparent px-3 py-2 text-sm outline-none placeholder:text-ink-faint"
              />
            </div>

            <div className="rule-t mt-5 flex flex-wrap items-center gap-2 pt-4">
              <input
                value={recipeName}
                onChange={(e) => setRecipeName(e.target.value)}
                placeholder="Recipe name"
                aria-label="Recipe name"
                className="flex-1 border border-rule bg-transparent px-3 py-1.5 text-sm outline-none placeholder:text-ink-faint"
              />
              <button
                type="button"
                onClick={saveRecipe}
                disabled={!recipeName.trim()}
                className="chip hover:border-ink hover:text-ink disabled:opacity-50"
              >
                Save recipe
              </button>
            </div>

            {recipes.length > 0 && (
              <div className="mt-3">
                <p className="label mb-2 text-ink-faint">Saved recipes</p>
                <div className="flex flex-wrap gap-2">
                  {recipes.map((r) => (
                    <Chip
                      key={r.id}
                      onClick={() => {
                        mix.load(r.request.picks);
                        setMode(r.request.mode);
                        setIntent(r.request.intent);
                        toast(`Loaded "${r.name}" v${r.version}`);
                      }}
                      title={`${r.request.picks.length} picks · v${r.version}`}
                    >
                      {r.name} v{r.version}
                    </Chip>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Composed output */}
          <div>
            {result && result.conflicts.length > 0 && (
              <div className="mb-4 space-y-2">
                <p className="label text-ink-faint">
                  Reconciled conflicts — already applied below
                </p>
                {result.conflicts.map((c, idx) => {
                  const s = SEVERITY[c.severity];
                  return (
                    <div key={idx} className={`border-l-2 ${s.cls} bg-paper-raised py-2 pl-3`}>
                      <p className="label">
                        {c.dimension} · {s.label}
                      </p>
                      <p className="mt-1 text-sm text-ink-muted">{c.description}</p>
                      <p className="mt-1.5 text-sm text-ink">
                        <span className="label text-accent">Resolution </span>
                        {c.resolution}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}

            {loading && !result ? (
              <div className="anim-shimmer h-96 border border-rule bg-paper-sunken" />
            ) : result ? (
              <>
                <MonoPanel
                  title={`COMPOSED PROMPT — ${mode}`}
                  body={result.prompt}
                  maxHeight="60vh"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <CopyButton text={result.prompt} label="Copy composed prompt" />
                  <button
                    type="button"
                    onClick={download}
                    className="chip hover:border-ink hover:text-ink"
                  >
                    Export as file
                  </button>
                  <CopyButton
                    text={mix.picks
                      .map((p) => `${p.role}: \`${p.slug}\``)
                      .join("\n")}
                    label="Copy slug lines"
                  />
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
