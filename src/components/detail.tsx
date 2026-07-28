"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { Inspiration, SearchHit } from "@/lib/schema";
import { useMixboard } from "@/lib/store";
import {
  Chip,
  CopyButton,
  MonoPanel,
  SwatchRow,
  toast,
} from "./primitives";
import { EditableField } from "./editable-field";

type Payload = {
  inspiration: Inspiration;
  similar: SearchHit[];
  overridden: string[];
};

const TABS = ["prompt", "brief", "tokens", "components", "detail"] as const;
type Tab = (typeof TABS)[number];

export function Detail({ initial }: { initial: Payload }) {
  const router = useRouter();
  const params = useSearchParams();
  const mix = useMixboard();
  const [data, setData] = useState(initial);
  const [tab, setTab] = useState<Tab>("prompt");
  const [busy, setBusy] = useState(false);
  const reviewing = params.get("review") === "1";

  const i = data.inspiration;
  const a = i.analysis;

  useEffect(() => setData(initial), [initial]);

  const patch = async (body: unknown) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/inspirations/${i.slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Save failed");
      const next = await res.json();
      setData((d) => ({ ...d, ...next }));
      router.refresh();
    } catch {
      toast("Could not save that edit.", "bad");
    } finally {
      setBusy(false);
    }
  };

  const reanalyze = async () => {
    setBusy(true);
    toast("Re-analysing — your edits are kept.");
    try {
      const res = await fetch(`/api/inspirations/${i.slug}/reanalyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setData((d) => ({ ...d, inspiration: json.inspiration }));
      toast(`Now on analysis v${json.inspiration.analysisVersion}`);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Re-analysis failed", "bad");
    } finally {
      setBusy(false);
    }
  };

  const referenceLine = `use \`${i.slug}\` — ${a.identity.dna}`;

  return (
    <div className="mx-auto max-w-[1600px] px-5 py-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link href="/" className="chip hover:border-ink hover:text-ink">
          ← Library
        </Link>
        <span className="font-mono text-2xs text-ink-faint">
          v{i.analysisVersion} · used {i.useCount}×
        </span>
        {i.humanVerified ? (
          <span className="label text-ok">◆ human-verified</span>
        ) : (
          <span
            className="label text-warn"
            title="Confidence and completeness of the AI analysis"
          >
            quality {i.qualityScore.toFixed(2)} · unverified
          </span>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <Chip
            active={mix.has(i.slug)}
            onClick={() => mix.toggle(i.slug)}
          >
            {mix.has(i.slug) ? "On the Mixboard" : "Add to Mixboard"}
          </Chip>
          <CopyButton text={referenceLine} label="Copy slug reference" slug={i.slug} />
          <button
            type="button"
            onClick={reanalyze}
            disabled={busy}
            className="chip hover:border-ink hover:text-ink disabled:opacity-50"
            title="Run the analysis again. Your edits are preserved."
          >
            Re-analyse
          </button>
        </div>
      </div>

      {reviewing && !i.humanVerified && (
        <div className="anim-fade-up mb-4 border border-accent bg-accent-soft px-4 py-3">
          <p className="text-sm">
            <strong className="display">Review this analysis.</strong> Anything
            you edit below is sticky — it outranks the AI text permanently,
            including after a re-analysis. Fields with a{" "}
            <span className="font-mono text-accent">◆</span> have been edited.
          </p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        {/* Left: the citation. */}
        <div className="lg:sticky lg:top-20 lg:self-start">
          <div className="border border-rule bg-paper-sunken">
            <img
              src={i.imagePath}
              alt={`${a.identity.name} — ${a.identity.dna}`}
              width={i.width}
              height={i.height}
              className="max-h-[70vh] w-full object-contain"
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <SwatchRow palette={a.color.palette} size={22} />
            <span className="label text-ink-faint">
              {i.width}×{i.height}
            </span>
            {i.provenance.sourceUrl && (
              <a
                href={i.provenance.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="label truncate text-accent hover:underline"
              >
                {i.provenance.sourceUrl.replace(/^https?:\/\//, "").slice(0, 40)}
              </a>
            )}
            <span className="label text-ink-faint">
              {i.provenance.captureKind} · {i.provenance.capturedAt.slice(0, 10)}
            </span>
          </div>

          <div className="mt-4">
            <p className="label mb-1.5 text-ink-faint">Your notes</p>
            <EditableField
              value={i.notes}
              placeholder="Used on the ClipForge landing — worked well…"
              multiline
              onSave={(notes) => patch({ notes })}
            />
          </div>
        </div>

        {/* Right: the value. */}
        <div>
          <h1 className="display text-3xl">
            <EditableField
              value={a.identity.name}
              inline
              onSave={(value) =>
                patch({ override: { field: "identity.name", value } })
              }
            />
          </h1>
          <p className="mt-1 font-mono text-xs text-ink-muted">
            {i.slug} · {a.identity.dna}
          </p>
          <div className="mt-3 text-base leading-relaxed text-ink-muted">
            <EditableField
              value={a.identity.whyItWorks}
              multiline
              edited={data.overridden.includes("identity.whyItWorks")}
              onSave={(value) =>
                patch({ override: { field: "identity.whyItWorks", value } })
              }
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Chip>{a.styleMood.family}</Chip>
            {a.styleMood.moods.slice(0, 4).map((m) => (
              <Chip key={m}>{m}</Chip>
            ))}
            <Chip>{a.layout.density}</Chip>
            <Chip>{a.motion.intensity} motion</Chip>
            <Chip>{a.implementation.difficulty}</Chip>
          </div>

          <nav className="mt-6 flex flex-wrap gap-2" aria-label="Artifact">
            {TABS.map((t) => (
              <Chip key={t} active={tab === t} onClick={() => setTab(t)}>
                {t}
              </Chip>
            ))}
          </nav>

          <div className="mt-3">
            {tab === "prompt" && (
              <>
                <MonoPanel
                  title="CLAUDE PROMPT — content-agnostic, paste as-is"
                  body={i.artifacts.claudePrompt}
                  maxHeight="34rem"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <CopyButton
                    text={i.artifacts.claudePrompt}
                    label="Copy Claude prompt"
                    slug={i.slug}
                  />
                  <CopyButton text={referenceLine} label="Copy slug line" slug={i.slug} />
                </div>
              </>
            )}

            {tab === "brief" && (
              <>
                <MonoPanel title="DESIGN BRIEF" body={i.artifacts.brief} maxHeight="34rem" />
                <div className="mt-3">
                  <CopyButton text={i.artifacts.brief} label="Copy brief" slug={i.slug} />
                </div>
              </>
            )}

            {tab === "tokens" && (
              <>
                <MonoPanel
                  title="TOKEN SET — Tailwind theme + CSS custom properties"
                  body={i.artifacts.tokenSet}
                  maxHeight="34rem"
                />
                <div className="mt-3">
                  <CopyButton text={i.artifacts.tokenSet} label="Copy tokens" slug={i.slug} />
                </div>
              </>
            )}

            {tab === "components" && (
              <ul className="space-y-4">
                {a.components.map((c) => (
                  <li key={`${c.kind}-${c.label}`} className="border border-rule">
                    <div className="flex items-center justify-between border-b border-rule px-4 py-2.5">
                      <span className="display text-lg">{c.label}</span>
                      <span className="label text-accent">{c.kind}</span>
                    </div>
                    <p className="px-4 py-3 text-sm text-ink-muted">{c.brief}</p>
                    <div className="px-4 pb-4">
                      <MonoPanel body={c.prompt} maxHeight="14rem" />
                      <div className="mt-2">
                        <CopyButton
                          text={c.prompt}
                          label={`Copy ${c.kind} prompt`}
                          slug={i.slug}
                        />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {tab === "detail" && (
              <div className="space-y-5">
                <Section title="Philosophy" confidence={a.identity.confidence}>
                  <ul className="space-y-1.5">
                    {a.philosophy.map((p) => (
                      <li key={p} className="text-sm text-ink-muted">
                        — {p}
                      </li>
                    ))}
                  </ul>
                </Section>

                <Section title="Anti-patterns — do not carry over">
                  <ul className="space-y-1.5">
                    {a.antiPatterns.map((p) => (
                      <li key={p} className="text-sm text-bad">
                        — {p}
                      </li>
                    ))}
                  </ul>
                </Section>

                <Section title="Typography" confidence={a.typography.confidence}>
                  <p className="text-sm text-ink-muted">{a.typography.pairingIntent}</p>
                  <dl className="mt-3 space-y-1.5 text-sm">
                    <Row k="Scale" v={a.typography.scaleRatio} />
                    <Row k="Weights" v={a.typography.weights.join(", ")} />
                    <Row k="Tracking/leading" v={a.typography.trackingLeading} />
                    <Row k="Casing" v={a.typography.casingHabits} />
                  </dl>
                  <ul className="mt-3 space-y-1.5">
                    {a.typography.fontCandidates.map((f) => (
                      <li key={f.name} className="font-mono text-2xs">
                        <span className="text-ink">{f.name}</span>
                        <span
                          className={
                            f.certainty === "identified"
                              ? "ml-2 text-ok"
                              : f.certainty === "likely"
                                ? "ml-2 text-warn"
                                : "ml-2 text-ink-faint"
                          }
                        >
                          {f.certainty}
                        </span>
                        <span className="ml-2 text-ink-faint">{f.role}</span>
                        <div className="text-ink-muted">{f.fallbackStack}</div>
                      </li>
                    ))}
                  </ul>
                </Section>

                <Section title="Colour" confidence={a.color.confidence}>
                  <p className="text-sm text-ink-muted">{a.color.paletteRationale}</p>
                  <p className="mt-2 text-sm text-ink-muted">{a.color.contrastNotes}</p>
                  <ul className="mt-3 space-y-1">
                    {a.color.palette.map((s) => (
                      <li key={`${s.hex}-${s.role}`} className="flex items-center gap-3">
                        <span
                          style={{ background: s.hex }}
                          className="h-4 w-4 border border-rule"
                        />
                        <span className="font-mono text-2xs">{s.hex}</span>
                        <span className="label text-accent">{s.role}</span>
                        <span className="label text-ink-faint">
                          {(s.weight * 100).toFixed(1)}%
                        </span>
                      </li>
                    ))}
                  </ul>
                </Section>

                <Section title="Layout & space" confidence={a.layout.confidence}>
                  <dl className="space-y-1.5 text-sm">
                    <Row k="Grid" v={a.layout.grid} />
                    <Row k="Columns" v={a.layout.columnLogic} />
                    <Row k="Rhythm" v={a.layout.spacingRhythm} />
                    <Row k="Alignment" v={a.layout.alignmentDiscipline} />
                    <Row k="Breakpoints" v={a.layout.breakpointBehaviour} />
                    <Row k="Section pacing" v={a.layout.sectionPacing} />
                  </dl>
                </Section>

                <Section title="Surface & depth" confidence={a.surface.confidence}>
                  <dl className="space-y-1.5 text-sm">
                    <Row k="Radius" v={a.surface.radiusLanguage} />
                    <Row k="Borders" v={a.surface.borderLanguage} />
                    <Row k="Shadow" v={a.surface.shadowPhilosophy} />
                    <Row k="Treatments" v={a.surface.treatments.join(", ") || "none"} />
                  </dl>
                </Section>

                <Section title="Motion" confidence={a.motion.confidence}>
                  <dl className="space-y-1.5 text-sm">
                    <Row k="Transitions" v={a.motion.transitions} />
                    <Row k="Easing" v={a.motion.easingCharacter} />
                    <Row k="Durations" v={a.motion.durations} />
                    <Row k="Scroll" v={a.motion.scrollBehaviour} />
                    <Row k="Hover/press" v={a.motion.hoverPress} />
                    <Row k="Entrance" v={a.motion.entranceChoreography} />
                  </dl>
                </Section>

                <Section title="UX patterns" confidence={a.ux.confidence}>
                  <dl className="space-y-1.5 text-sm">
                    <Row k="Hierarchy" v={a.ux.hierarchyStrategy} />
                    <Row k="CTA logic" v={a.ux.ctaLogic} />
                    <Row k="Density" v={a.ux.densityDecisions} />
                    <Row k="Accessibility" v={a.ux.accessibilityObservations} />
                  </dl>
                </Section>

                <Section
                  title="Implementation"
                  confidence={a.implementation.confidence}
                >
                  <p className="text-sm text-ink-muted">
                    {a.implementation.cssApproach}
                  </p>
                  {a.implementation.gotchas.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {a.implementation.gotchas.map((g) => (
                        <li key={g} className="text-sm text-warn">
                          ! {g}
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>
              </div>
            )}
          </div>

          {/* Actions row — flat bordered mono buttons, as in the reference. */}
          <div className="rule-t mt-6 flex flex-wrap gap-2 pt-4">
            <CopyButton text={i.artifacts.brief} label="Copy Brief" slug={i.slug} />
            <CopyButton
              text={i.artifacts.claudePrompt}
              label="Copy Claude Prompt"
              slug={i.slug}
            />
            <CopyButton text={i.artifacts.tokenSet} label="Copy Tokens" slug={i.slug} />
            {!i.humanVerified && (
              <button
                type="button"
                onClick={() => patch({ verified: true })}
                disabled={busy}
                className="chip border-ok text-ok hover:bg-ok hover:text-paper"
              >
                Mark verified
              </button>
            )}
            <Link href="/" className="chip ml-auto hover:border-ink hover:text-ink">
              Close
            </Link>
          </div>

          {data.similar.length > 0 && (
            <div className="rule-t mt-6 pt-4">
              <p className="label mb-3 text-ink-faint">Similar in your library</p>
              <ul className="flex gap-3 overflow-x-auto pb-2">
                {data.similar.map((s) => (
                  <li key={s.slug} className="w-44 shrink-0">
                    <Link href={`/i/${s.slug}`} className="group block">
                      <img
                        src={s.thumbPath}
                        alt={s.name}
                        width={720}
                        height={900}
                        loading="lazy"
                        className="aspect-[4/3] w-full border border-rule object-cover object-top transition-colors duration-[120ms] group-hover:border-ink"
                      />
                      <p className="display mt-1.5 truncate text-sm">{s.name}</p>
                      <p className="truncate font-mono text-2xs text-ink-faint">
                        {s.matchedOn.join(", ") || s.dna}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  confidence,
  children,
}: {
  title: string;
  confidence?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-rule">
      <div className="flex items-center justify-between border-b border-rule px-4 py-2.5">
        <h2 className="label text-ink">{title}</h2>
        {confidence !== undefined && (
          <span
            className={`label ${
              confidence >= 0.75
                ? "text-ok"
                : confidence >= 0.5
                  ? "text-warn"
                  : "text-bad"
            }`}
            title="How confident the analysis is about this section"
          >
            {confidence.toFixed(2)}
          </span>
        )}
      </div>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="flex gap-3">
    <dt className="label w-32 shrink-0 pt-0.5 text-ink-faint">{k}</dt>
    <dd className="flex-1 text-ink-muted">{v}</dd>
  </div>
);
