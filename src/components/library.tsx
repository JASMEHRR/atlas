"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Facets, SearchHit } from "@/lib/schema";
import { useMixboard } from "@/lib/store";
import { Chip, CardSkeleton, SwatchRow, pad2, toast } from "./primitives";
import { IngestZone } from "./ingest-zone";

type FacetCounts = {
  family: Array<{ value: string; count: number }>;
  density: Array<{ value: string; count: number }>;
  motion: Array<{ value: string; count: number }>;
  difficulty: Array<{ value: string; count: number }>;
  components: Array<{ value: string; count: number }>;
  tags: Array<{ value: string; count: number }>;
  colors: Array<{ value: string; count: number }>;
};

type View = "grid" | "masonry" | "compact";

const EMPTY_FACETS: Facets = {
  family: [],
  moods: [],
  components: [],
  color: null,
  density: [],
  motion: [],
  difficulty: [],
  collection: null,
  verifiedOnly: false,
};

export function Library({ collection }: { collection?: string }) {
  const router = useRouter();
  const mix = useMixboard();
  const [q, setQ] = useState("");
  const [facets, setFacets] = useState<Facets>({
    ...EMPTY_FACETS,
    collection: collection ?? null,
  });
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [counts, setCounts] = useState<FacetCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("grid");
  const [cursor, setCursor] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q, facets, limit: 200, expand: false }),
      });
      const data = await res.json();
      setHits(data.hits ?? []);
      setCounts(data.facets ?? null);
    } catch {
      toast("Could not reach the library.", "bad");
    } finally {
      setLoading(false);
    }
  }, [q, facets]);

  useEffect(() => {
    const t = setTimeout(load, q ? 220 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const active = useMemo(
    () =>
      facets.family.length +
      facets.moods.length +
      facets.components.length +
      facets.density.length +
      facets.motion.length +
      facets.difficulty.length +
      (facets.color ? 1 : 0) +
      (facets.verifiedOnly ? 1 : 0),
    [facets],
  );

  const toggleFacet = <K extends "family" | "moods" | "components" | "density" | "motion" | "difficulty">(
    key: K,
    value: string,
  ) =>
    setFacets((f) => {
      const list = f[key] as string[];
      return {
        ...f,
        [key]: list.includes(value)
          ? list.filter((v) => v !== value)
          : [...list, value],
      } as Facets;
    });

  /* j/k/enter/c/x on the grid. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (
        el?.tagName === "INPUT" ||
        el?.tagName === "TEXTAREA" ||
        el?.isContentEditable
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (hits.length === 0) return;

      if (e.key === "j") {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, hits.length - 1));
      } else if (e.key === "k") {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      } else if (e.key === "Enter" && cursor >= 0) {
        e.preventDefault();
        router.push(`/i/${hits[cursor]!.slug}`);
      } else if (e.key === "x" && cursor >= 0) {
        e.preventDefault();
        const hit = hits[cursor]!;
        mix.toggle(hit.slug);
        toast(
          mix.has(hit.slug)
            ? `Removed ${hit.slug} from the Mixboard`
            : `Added ${hit.slug} to the Mixboard`,
        );
      } else if (e.key === "c" && cursor >= 0) {
        e.preventDefault();
        const slug = hits[cursor]!.slug;
        void (async () => {
          const res = await fetch(`/api/v1/inspirations/${slug}?section=prompt`);
          const data = await res.json();
          await navigator.clipboard.writeText(data.content ?? "");
          toast(`Copied ${slug}'s Claude prompt`);
        })();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hits, cursor, router, mix]);

  useEffect(() => {
    if (cursor < 0) return;
    gridRef.current
      ?.querySelectorAll("[data-card]")
      [cursor]?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  return (
    <div className="mx-auto max-w-[1600px] px-5 py-6">
      {/* Filter rail — chips, exactly as in the reference grid. */}
      <div className="flex flex-wrap items-center gap-2">
        <Chip
          active={active === 0}
          count={counts?.family.reduce((s, f) => s + f.count, 0)}
          onClick={() =>
            setFacets({ ...EMPTY_FACETS, collection: collection ?? null })
          }
        >
          All
        </Chip>
        {counts?.family.map((f) => (
          <Chip
            key={f.value}
            active={facets.family.includes(f.value as never)}
            count={f.count}
            onClick={() => toggleFacet("family", f.value)}
          >
            {f.value}
          </Chip>
        ))}
        <Chip
          active={facets.verifiedOnly}
          onClick={() =>
            setFacets((f) => ({ ...f, verifiedOnly: !f.verifiedOnly }))
          }
          title="Only entries a human has checked"
        >
          ◆ Verified
        </Chip>
      </div>

      <details className="mt-3 border border-rule">
        <summary className="label cursor-pointer px-4 py-2.5 text-ink-muted hover:text-ink">
          More filters
          {active > facets.family.length ? (
            <span className="ml-2 text-accent">
              {active - facets.family.length}
            </span>
          ) : null}
        </summary>
        <div className="space-y-4 border-t border-rule px-4 py-4">
          {(
            [
              ["density", counts?.density],
              ["motion", counts?.motion],
              ["difficulty", counts?.difficulty],
              ["components", counts?.components],
            ] as const
          ).map(([key, list]) => (
            <div key={key}>
              <p className="label mb-2 text-ink-faint">{key}</p>
              <div className="flex flex-wrap gap-2">
                {list?.map((f) => (
                  <Chip
                    key={f.value}
                    active={(facets[key] as string[]).includes(f.value)}
                    count={f.count}
                    onClick={() => toggleFacet(key, f.value)}
                  >
                    {f.value}
                  </Chip>
                ))}
              </div>
            </div>
          ))}

          <div>
            <p className="label mb-2 text-ink-faint">tags</p>
            <div className="flex flex-wrap gap-2">
              {counts?.tags.map((t) => (
                <Chip
                  key={t.value}
                  active={facets.moods.includes(t.value)}
                  count={t.count}
                  onClick={() => toggleFacet("moods", t.value)}
                >
                  {t.value}
                </Chip>
              ))}
            </div>
          </div>

          <div>
            <p className="label mb-2 text-ink-faint">
              dominant colour {facets.color && `— ${facets.color}`}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {counts?.colors.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  title={`${c.value} (${c.count})`}
                  aria-label={`Filter by colour ${c.value}`}
                  aria-pressed={facets.color === c.value}
                  onClick={() =>
                    setFacets((f) => ({
                      ...f,
                      color: f.color === c.value ? null : c.value,
                    }))
                  }
                  style={{ background: c.value }}
                  className={`h-6 w-6 border transition-transform duration-[120ms] ${
                    facets.color === c.value
                      ? "scale-110 border-ink"
                      : "border-rule hover:scale-110"
                  }`}
                />
              ))}
              {facets.color && (
                <Chip onClick={() => setFacets((f) => ({ ...f, color: null }))}>
                  Clear
                </Chip>
              )}
            </div>
            <p className="mt-1.5 text-2xs text-ink-faint">
              Matches perceptually close colours, not exact hex.
            </p>
          </div>
        </div>
      </details>

      {/* Search + view switch */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="flex min-w-64 flex-1 items-center gap-2 border border-rule px-3 py-2">
          <span className="label text-accent">/</span>
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter the library…"
            aria-label="Filter the library"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-ink-faint"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              className="label text-ink-faint hover:text-ink"
            >
              Clear
            </button>
          )}
        </div>
        <div className="flex gap-2">
          {(["grid", "masonry", "compact"] as View[]).map((v) => (
            <Chip key={v} active={view === v} onClick={() => setView(v)}>
              {v}
            </Chip>
          ))}
        </div>
      </div>

      <IngestZone onDone={load} />

      {/* Results */}
      {loading && hits.length === 0 ? (
        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 6 }, (_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : hits.length === 0 ? (
        <EmptyState
          hasQuery={Boolean(q) || active > 0}
          onClear={() => {
            setQ("");
            setFacets({ ...EMPTY_FACETS, collection: collection ?? null });
          }}
        />
      ) : (
        <div
          ref={gridRef}
          className={
            view === "compact"
              ? "mt-6 border border-rule"
              : view === "masonry"
                ? "mt-6 columns-1 gap-5 sm:columns-2 lg:columns-3 2xl:columns-4"
                : "mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
          }
        >
          {hits.map((hit, i) =>
            view === "compact" ? (
              <CompactRow
                key={hit.slug}
                hit={hit}
                index={i}
                total={hits.length}
                focused={i === cursor}
                selected={mix.has(hit.slug)}
                onSelect={() => mix.toggle(hit.slug)}
              />
            ) : (
              <Card
                key={hit.slug}
                hit={hit}
                index={i}
                total={hits.length}
                focused={i === cursor}
                masonry={view === "masonry"}
                selected={mix.has(hit.slug)}
                onSelect={() => mix.toggle(hit.slug)}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function Card({
  hit,
  index,
  total,
  focused,
  masonry,
  selected,
  onSelect,
}: {
  hit: SearchHit;
  index: number;
  total: number;
  focused: boolean;
  masonry: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const [peek, setPeek] = useState(false);
  const extra = Math.max(0, hit.tags.length - 3);

  return (
    <div
      data-card
      onMouseEnter={() => setPeek(true)}
      onMouseLeave={() => setPeek(false)}
      className={`group relative border bg-paper-raised transition-colors duration-[120ms] ${
        masonry ? "mb-5 break-inside-avoid" : ""
      } ${
        focused
          ? "border-focus ring-2 ring-focus"
          : selected
            ? "border-accent"
            : "border-rule hover:border-rule-strong"
      }`}
      style={{
        // Native windowing: off-screen cards skip layout and paint entirely,
        // which holds 60fps past 500 cards without a virtualization library.
        // The intrinsic size matches the real card, so nothing shifts.
        contentVisibility: "auto",
        containIntrinsicSize: "460px 420px",
      }}
    >
      <Link href={`/i/${hit.slug}`} className="block">
        <div className="relative overflow-hidden border-b border-rule bg-paper-sunken">
          {/* Fixed aspect box: the image never dictates layout, so no CLS. */}
          <img
            src={hit.thumbPath}
            alt={`${hit.name} — ${hit.dna}`}
            width={720}
            height={900}
            loading="lazy"
            decoding="async"
            className={`w-full object-cover object-top ${
              masonry ? "" : "aspect-[4/3]"
            }`}
          />
          {peek && (
            <div className="anim-veil absolute inset-0 flex flex-col justify-end bg-ink/80 p-4">
              <p className="text-sm leading-snug text-paper">{hit.whyItWorks}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {hit.tags.slice(0, 6).map((t) => (
                  <span
                    key={t}
                    className="border border-paper/40 px-2 py-0.5 font-mono text-2xs text-paper/90"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="p-4">
          {/* Wraps rather than truncating: the name is the handle, and a
              squeezed "Warm E…" is useless. If the DNA doesn't fit beside it,
              it drops to its own line. */}
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h3 className="display text-xl">{hit.name}</h3>
            <span className="font-mono text-2xs text-ink-muted">{hit.dna}</span>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {hit.tags.slice(0, 3).map((t) => (
              <span key={t} className="chip">
                {t}
              </span>
            ))}
            {extra > 0 && (
              <span className="label self-center text-ink-faint">+{extra}</span>
            )}
          </div>
        </div>
      </Link>

      <div className="flex items-center justify-between border-t border-rule px-4 py-2.5">
        <span className="label flex items-center gap-1.5 text-accent">
          ◆ {hit.family}
          {hit.humanVerified && <span className="text-ok">· verified</span>}
        </span>
        <span className="label text-ink-faint">
          {pad2(index + 1)} / {pad2(total)}
        </span>
      </div>

      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={`${selected ? "Remove" : "Add"} ${hit.name} ${selected ? "from" : "to"} the Mixboard`}
        className={`chip absolute top-3 right-3 backdrop-blur transition-opacity duration-[120ms] ${
          selected
            ? "border-accent bg-accent text-paper opacity-100"
            : "bg-paper/90 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        }`}
      >
        {selected ? "On board" : "Mix"}
      </button>
    </div>
  );
}

function CompactRow({
  hit,
  index,
  total,
  focused,
  selected,
  onSelect,
}: {
  hit: SearchHit;
  index: number;
  total: number;
  focused: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      data-card
      className={`flex items-center gap-4 border-b border-rule px-4 py-2.5 transition-colors duration-[120ms] ${
        focused ? "bg-paper-sunken" : "hover:bg-paper-sunken"
      }`}
    >
      <span className="label w-16 shrink-0 text-ink-faint">
        {pad2(index + 1)} / {pad2(total)}
      </span>
      <SwatchRow palette={hit.palette.slice(0, 6)} size={12} />
      <Link href={`/i/${hit.slug}`} className="flex min-w-0 flex-1 items-baseline gap-3">
        <span className="display truncate text-base">{hit.name}</span>
        <span className="truncate font-mono text-2xs text-ink-muted">
          {hit.dna}
        </span>
      </Link>
      <span className="label hidden shrink-0 text-accent md:inline">
        {hit.family}
      </span>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={`chip shrink-0 ${selected ? "border-accent text-accent" : ""}`}
      >
        {selected ? "On board" : "Mix"}
      </button>
    </div>
  );
}

/** Empty states teach and suggest — never shrug. */
function EmptyState({
  hasQuery,
  onClear,
}: {
  hasQuery: boolean;
  onClear: () => void;
}) {
  return (
    <div className="mt-6 border border-rule bg-paper-raised px-8 py-14 text-center">
      <p className="display text-2xl">
        {hasQuery ? "Nothing matches those filters" : "The library is empty"}
      </p>
      {hasQuery ? (
        <>
          <p className="mx-auto mt-3 max-w-lg text-sm text-ink-muted">
            Search covers each design's written analysis — its moods,
            techniques and principles — not the words in the screenshot. Try a
            broader term, or clear the filters and browse.
          </p>
          <button
            type="button"
            onClick={onClear}
            className="chip mt-5 border-ink hover:bg-ink hover:text-paper"
          >
            Clear filters
          </button>
        </>
      ) : (
        <>
          <p className="mx-auto mt-3 max-w-lg text-sm text-ink-muted">
            Drop a screenshot anywhere on this page, paste one from your
            clipboard, or give a URL. Atlas extracts the palette, analyses the
            design language, and gives it a slug you can hand to Claude Code —
            like <span className="font-mono text-accent">use apple-glass-nav</span>.
          </p>
          <p className="mx-auto mt-4 max-w-lg text-sm text-ink-faint">
            Start with three or four references you already admire. Patterns in
            your taste show up around ten.
          </p>
        </>
      )}
    </div>
  );
}
