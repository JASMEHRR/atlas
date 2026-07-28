"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Inspiration, SearchHit } from "@/lib/schema";
import { Chip, SwatchRow } from "./primitives";

/**
 * Side-by-side, with the differences articulated in words. The verdict lines
 * are computed from the structured analysis — no extra model call, and no
 * "these are different" filler.
 */
export function Compare() {
  const [all, setAll] = useState<SearchHit[]>([]);
  const [left, setLeft] = useState<Inspiration | null>(null);
  const [right, setRight] = useState<Inspiration | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/search");
      setAll((await res.json()).hits ?? []);
    })();
  }, []);

  const pick = async (slug: string, side: "left" | "right") => {
    const res = await fetch(`/api/inspirations/${slug}`);
    const { inspiration } = await res.json();
    (side === "left" ? setLeft : setRight)(inspiration);
  };

  return (
    <div className="mx-auto max-w-[1600px] px-5 py-6">
      <header className="flex flex-wrap items-baseline gap-4">
        <h1 className="display text-2xl">Compare</h1>
        <p className="max-w-2xl text-sm text-ink-muted">
          Two references side by side, with the differences stated rather than
          left for you to spot.
        </p>
      </header>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {(["left", "right"] as const).map((side) => (
          <div key={side}>
            <p className="label mb-2 text-ink-faint">{side}</p>
            <div className="flex flex-wrap gap-2">
              {all.map((h) => {
                const current = side === "left" ? left : right;
                return (
                  <Chip
                    key={h.slug}
                    active={current?.slug === h.slug}
                    onClick={() => void pick(h.slug, side)}
                  >
                    {h.slug}
                  </Chip>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {left && right ? (
        left.slug === right.slug ? (
          <p className="mt-8 border border-rule bg-paper-raised px-6 py-10 text-center text-sm text-ink-muted">
            Same reference on both sides — pick a different one to compare.
          </p>
        ) : (
          <>
            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              {[left, right].map((i) => (
                <div key={i.slug}>
                  <img
                    src={i.thumbPath}
                    alt={i.analysis.identity.name}
                    width={720}
                    height={900}
                    className="aspect-[4/3] w-full border border-rule object-cover object-top"
                  />
                  <Link href={`/i/${i.slug}`}>
                    <h2 className="display mt-3 text-xl hover:text-accent">
                      {i.analysis.identity.name}
                    </h2>
                  </Link>
                  <p className="font-mono text-2xs text-ink-muted">
                    {i.analysis.identity.dna}
                  </p>
                  <div className="mt-2">
                    <SwatchRow palette={i.analysis.color.palette} size={18} />
                  </div>
                  <p className="mt-3 text-sm text-ink-muted">
                    {i.analysis.identity.whyItWorks}
                  </p>
                </div>
              ))}
            </div>

            <div className="rule-t mt-8 pt-6">
              <h2 className="label mb-3 text-ink-faint">What differs</h2>
              <ul className="space-y-2">
                {differences(left, right).map((d) => (
                  <li key={d.dimension} className="border border-rule px-4 py-3">
                    <p className="label text-accent">{d.dimension}</p>
                    <p className="mt-1 text-sm text-ink-muted">{d.verdict}</p>
                  </li>
                ))}
              </ul>

              <h2 className="label mt-6 mb-3 text-ink-faint">What they share</h2>
              <div className="flex flex-wrap gap-2">
                {shared(left, right).map((s) => (
                  <Chip key={s}>{s}</Chip>
                ))}
                {shared(left, right).length === 0 && (
                  <p className="text-sm text-ink-faint">
                    Nothing meaningful in common — these two are genuinely
                    different languages, so mixing them will need real
                    reconciliation.
                  </p>
                )}
              </div>
            </div>
          </>
        )
      ) : (
        <p className="mt-8 border border-rule bg-paper-raised px-6 py-10 text-center text-sm text-ink-muted">
          Pick one reference on each side.
        </p>
      )}
    </div>
  );
}

function differences(a: Inspiration, b: Inspiration) {
  const x = a.analysis;
  const y = b.analysis;
  const nameA = x.identity.name;
  const nameB = y.identity.name;
  const out: Array<{ dimension: string; verdict: string }> = [];

  const add = (dimension: string, verdict: string) => out.push({ dimension, verdict });

  if (x.styleMood.family !== y.styleMood.family) {
    add(
      "Style family",
      `${nameA} is ${x.styleMood.family}; ${nameB} is ${y.styleMood.family}. That is the deepest split between them — most other differences follow from it.`,
    );
  }
  if (x.layout.density !== y.layout.density) {
    add(
      "Density",
      `${nameA} is ${x.layout.density} (${x.layout.spacingRhythm}); ${nameB} is ${y.layout.density} (${y.layout.spacingRhythm}). Using both in one build means picking one rhythm and re-spacing the other's components onto it.`,
    );
  }
  if (x.motion.intensity !== y.motion.intensity) {
    add(
      "Motion",
      `${nameA} is ${x.motion.intensity} (${x.motion.easingCharacter}); ${nameB} is ${y.motion.intensity} (${y.motion.easingCharacter}). Mixed easing families read as sloppiness — commit to one.`,
    );
  }
  if (x.typography.scaleRatio !== y.typography.scaleRatio) {
    add(
      "Type scale",
      `${nameA} uses ${x.typography.scaleRatio}; ${nameB} uses ${y.typography.scaleRatio}. ${x.typography.pairingIntent.split(".")[0]} versus ${y.typography.pairingIntent.split(".")[0]}.`,
    );
  }
  if (x.surface.radiusLanguage !== y.surface.radiusLanguage) {
    add(
      "Surface",
      `${nameA}: ${x.surface.radiusLanguage} ${nameB}: ${y.surface.radiusLanguage} Corner language is a strong style tell; mixing sharp and rounded reads as inconsistent.`,
    );
  }

  const groundA = x.color.palette.find((p) => p.role === "ground");
  const groundB = y.color.palette.find((p) => p.role === "ground");
  if (groundA && groundB && groundA.hex !== groundB.hex) {
    add(
      "Ground",
      `${nameA} sits on ${groundA.hex}; ${nameB} on ${groundB.hex}. ${
        x.color.paletteRationale.split(".")[0]
      } — versus — ${y.color.paletteRationale.split(".")[0]}.`,
    );
  }
  if (x.implementation.difficulty !== y.implementation.difficulty) {
    add(
      "Effort",
      `${nameA} is ${x.implementation.difficulty} to build; ${nameB} is ${y.implementation.difficulty}.`,
    );
  }

  const onlyA = x.components.map((c) => c.kind).filter((k) => !y.components.some((c) => c.kind === k));
  const onlyB = y.components.map((c) => c.kind).filter((k) => !x.components.some((c) => c.kind === k));
  if (onlyA.length || onlyB.length) {
    add(
      "Components covered",
      `${onlyA.length ? `Only ${nameA} demonstrates: ${[...new Set(onlyA)].join(", ")}. ` : ""}${onlyB.length ? `Only ${nameB} demonstrates: ${[...new Set(onlyB)].join(", ")}.` : ""}`,
    );
  }

  if (out.length === 0) {
    add(
      "Close relatives",
      `${nameA} and ${nameB} agree on style, density, motion, type scale and surface. They are variations on one language rather than two — safe to mix without reconciliation.`,
    );
  }
  return out;
}

function shared(a: Inspiration, b: Inspiration): string[] {
  const x = a.analysis;
  const y = b.analysis;
  const out: string[] = [];
  if (x.styleMood.family === y.styleMood.family) out.push(x.styleMood.family);
  if (x.layout.density === y.layout.density) out.push(`${x.layout.density} density`);
  if (x.motion.intensity === y.motion.intensity) out.push(`${x.motion.intensity} motion`);
  if (x.implementation.difficulty === y.implementation.difficulty) {
    out.push(`${x.implementation.difficulty} to build`);
  }
  for (const tag of x.tags) if (y.tags.includes(tag)) out.push(tag);
  for (const mood of x.styleMood.moods) if (y.styleMood.moods.includes(mood)) out.push(mood);
  return [...new Set(out)];
}
