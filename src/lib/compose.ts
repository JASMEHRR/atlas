/**
 * Mixboard composition.
 *
 * The whole point is that this does NOT concatenate briefs. Each pick
 * contributes only the slice its role owns, conflicts across picks are
 * detected up front, and every conflict is resolved explicitly in the output
 * with the resolution stated — so the reader knows a decision was made.
 */
import {
  ComposedPrompt,
  type Analysis,
  type ComposeRequest,
  type Conflict,
  type MixPick,
  type MixRole,
} from "./schema.ts";
import { deltaE, hexToLab, contrastRatio } from "./color.ts";
import { effectiveAnalysis, recordUse } from "./repo.ts";

type Loaded = { pick: MixPick; analysis: Analysis };

/** Which role wins when two picks both want to own a dimension. */
const OWNS: Record<MixRole, string> = {
  navigation: "the navigation component",
  hero: "the hero section",
  typography: "all type decisions",
  color: "the entire palette",
  layout: "grid, spacing and section pacing",
  motion: "all motion and transitions",
  surface: "radii, borders, shadows and texture",
  component: "the named component only",
  voice: "tone and copy character",
};

const ORDER: Record<string, number> = {
  airy: 0,
  balanced: 1,
  dense: 2,
  still: 0,
  restrained: 1,
  lively: 2,
  cinematic: 3,
};

function detectConflicts(loaded: Loaded[]): Conflict[] {
  const conflicts: Conflict[] = [];
  const owner = (role: MixRole) => loaded.find((l) => l.pick.role === role);

  /* --- palette: picks that aren't the colour owner still imply colours --- */
  const colorOwner = owner("color") ?? loaded[0]!;
  for (const l of loaded) {
    if (l === colorOwner) continue;
    const a = l.analysis.color.palette.find((p) => p.role === "accent");
    const b = colorOwner.analysis.color.palette.find((p) => p.role === "accent");
    if (!a || !b) continue;
    const distance = deltaE(hexToLab(a.hex), hexToLab(b.hex));
    // CIEDE2000 compresses at the top of its range — rust vs blue is only
    // ~45, not ~100. 25 is roughly "different colour family", 40 is "these
    // were never going to sit together".
    if (distance > 25) {
      conflicts.push({
        dimension: "color",
        severity: distance > 40 ? "incompatible" : "warning",
        between: [colorOwner.pick.slug, l.pick.slug],
        description: `"${l.analysis.identity.name}" is built around ${a.hex} while the palette owner "${colorOwner.analysis.identity.name}" uses ${b.hex} (ΔE ${distance.toFixed(0)}). Its proportions and contrast assumptions were tuned for its own accent.`,
        resolution: `Take ${b.hex} as the accent throughout. Re-derive "${l.analysis.identity.name}"'s contribution against it — keep the *relationships* (how much accent, where it lands, what it emphasises), discard its literal hex values.`,
      });
    }
  }

  /* --- ground polarity: light-on-dark vs dark-on-light is structural --- */
  const grounds = loaded
    .map((l) => ({
      l,
      ground: l.analysis.color.palette.find((p) => p.role === "ground"),
    }))
    .filter((g) => g.ground);
  const lightGrounds = grounds.filter((g) => hexToLab(g.ground!.hex).l > 50);
  const darkGrounds = grounds.filter((g) => hexToLab(g.ground!.hex).l <= 50);
  if (lightGrounds.length && darkGrounds.length) {
    const winner =
      grounds.find((g) => g.l === colorOwner) ?? lightGrounds[0] ?? grounds[0]!;
    const winnerIsLight = hexToLab(winner.ground!.hex).l > 50;
    conflicts.push({
      dimension: "color",
      severity: "warning",
      between: [
        ...lightGrounds.map((g) => g.l.pick.slug),
        ...darkGrounds.map((g) => g.l.pick.slug),
      ],
      description: `Mixing ${winnerIsLight ? "dark" : "light"}-ground and ${winnerIsLight ? "light" : "dark"}-ground references. Shadow, border weight and text contrast do not transfer across that boundary — a hairline border that reads as refined on light ground disappears on dark.`,
      resolution: `Commit to a ${winnerIsLight ? "light" : "dark"} ground (${winner.ground!.hex}, from "${winner.l.analysis.identity.name}"). Where a ${winnerIsLight ? "dark" : "light"}-ground reference contributes surface treatment, invert its logic rather than its values: ${winnerIsLight ? "translate glow-based separation into border and shadow" : "translate shadow-based elevation into luminosity and glow"}.`,
    });
  }

  /* --- density --- */
  const densities = [...new Set(loaded.map((l) => l.analysis.layout.density))];
  if (densities.length > 1) {
    const layoutOwner = owner("layout") ?? loaded[0]!;
    const gap =
      Math.max(...densities.map((d) => ORDER[d]!)) -
      Math.min(...densities.map((d) => ORDER[d]!));
    conflicts.push({
      dimension: "density",
      severity: gap >= 2 ? "incompatible" : "warning",
      between: loaded.map((l) => l.pick.slug),
      description: `Picks disagree on density (${densities.join(" vs ")}).${gap >= 2 ? " Airy and dense are opposite information-design philosophies; splitting the difference produces a page that reads as neither." : ""}`,
      resolution: `Use ${layoutOwner.analysis.layout.density} throughout, from "${layoutOwner.analysis.identity.name}" (${layoutOwner.analysis.layout.spacingRhythm}). Components borrowed from a ${densities.filter((d) => d !== layoutOwner.analysis.layout.density).join("/")} reference must be re-spaced onto that rhythm, not pasted at their native spacing.`,
    });
  }

  /* --- motion --- */
  const motions = [...new Set(loaded.map((l) => l.analysis.motion.intensity))];
  if (motions.length > 1) {
    const motionOwner = owner("motion") ?? loaded[0]!;
    const gap =
      Math.max(...motions.map((m) => ORDER[m]!)) -
      Math.min(...motions.map((m) => ORDER[m]!));
    conflicts.push({
      dimension: "motion",
      severity: gap >= 2 ? "incompatible" : "note",
      between: loaded.map((l) => l.pick.slug),
      description: `Motion languages differ (${motions.join(" vs ")}). Mixed easing families are the most common tell of a stitched-together interface — the eye reads inconsistent timing as sloppiness even when it can't name why.`,
      resolution: `One easing family only: ${motionOwner.analysis.motion.easingCharacter}, durations ${motionOwner.analysis.motion.durations} (from "${motionOwner.analysis.identity.name}"). Other picks contribute *which* elements animate, never how fast or with what curve.`,
    });
  }

  /* --- typography --- */
  const typeOwner = owner("typography");
  if (typeOwner) {
    const others = loaded.filter(
      (l) =>
        l !== typeOwner &&
        l.analysis.typography.scaleRatio !== typeOwner.analysis.typography.scaleRatio,
    );
    if (others.length) {
      conflicts.push({
        dimension: "typography",
        severity: "note",
        between: [typeOwner.pick.slug, ...others.map((o) => o.pick.slug)],
        description: `Other picks use different type scales (${others.map((o) => o.analysis.typography.scaleRatio).join(", ")}) than the typography owner (${typeOwner.analysis.typography.scaleRatio}).`,
        resolution: `One scale wins: ${typeOwner.analysis.typography.scaleRatio}. Map every borrowed component's type onto the nearest step of that scale rather than keeping its original sizes.`,
      });
    }
  }

  /* --- surface --- */
  const radii = new Set(loaded.map((l) => l.analysis.surface.radiusLanguage));
  if (radii.size > 1) {
    const surfaceOwner = owner("surface") ?? owner("layout") ?? loaded[0]!;
    conflicts.push({
      dimension: "surface",
      severity: "note",
      between: loaded.map((l) => l.pick.slug),
      description: `Corner and border languages differ across picks. Radius is a strong style signal; mixing sharp and heavily rounded reads as inconsistent.`,
      resolution: `Adopt "${surfaceOwner.analysis.identity.name}"'s surface language: ${surfaceOwner.analysis.surface.radiusLanguage}; borders ${surfaceOwner.analysis.surface.borderLanguage}; shadows ${surfaceOwner.analysis.surface.shadowPhilosophy}.`,
    });
  }

  return conflicts;
}

/** Only the slice this role actually owns. This is what stops concatenation. */
function contribution(l: Loaded): string {
  const a = l.analysis;
  const head = `### ${a.identity.name} → ${l.pick.role}\n_${a.identity.dna}. Owns ${OWNS[l.pick.role]}._`;

  switch (l.pick.role) {
    case "color":
      return `${head}

Palette (use these exact values):
${a.color.palette.map((p) => `- ${p.role}: ${p.hex}`).join("\n")}

${a.color.paletteRationale}
Contrast discipline: ${a.color.contrastNotes}`;

    case "typography":
      return `${head}

${a.typography.pairingIntent}
- Scale: ${a.typography.scaleRatio}
- Weights: ${a.typography.weights.join(", ") || "as needed"}
- Tracking/leading: ${a.typography.trackingLeading}
- Casing: ${a.typography.casingHabits}
- Faces: ${a.typography.fontCandidates.map((f) => `${f.role} → ${f.fallbackStack}`).join(" | ") || "system stacks"}`;

    case "layout":
      return `${head}

- Grid: ${a.layout.grid}
- Columns: ${a.layout.columnLogic}
- Spacing rhythm: ${a.layout.spacingRhythm}
- Density: ${a.layout.density}
- Alignment: ${a.layout.alignmentDiscipline}
- Responsive: ${a.layout.breakpointBehaviour}
- Section pacing: ${a.layout.sectionPacing}`;

    case "motion":
      return `${head}

- Transitions: ${a.motion.transitions}
- Easing: ${a.motion.easingCharacter}
- Durations: ${a.motion.durations}
- Scroll: ${a.motion.scrollBehaviour}
- Hover/press: ${a.motion.hoverPress}
- Entrance: ${a.motion.entranceChoreography}
Respect prefers-reduced-motion.`;

    case "surface":
      return `${head}

- Radius: ${a.surface.radiusLanguage}
- Borders: ${a.surface.borderLanguage}
- Shadow: ${a.surface.shadowPhilosophy}
- Treatments: ${a.surface.treatments.join(", ") || "none"}`;

    case "voice":
      return `${head}

Personality: ${a.styleMood.brandPersonality}
Mood: ${a.styleMood.moods.join(", ")}
CTA logic: ${a.ux.ctaLogic}
Hierarchy strategy: ${a.ux.hierarchyStrategy}`;

    case "navigation":
    case "hero":
    case "component": {
      const wanted = l.pick.detail.toLowerCase();
      const target =
        a.components.find(
          (c) =>
            (wanted && (c.kind.includes(wanted) || c.label.toLowerCase().includes(wanted))) ||
            (l.pick.role === "navigation" && c.kind === "navbar") ||
            (l.pick.role === "hero" && c.kind === "hero"),
        ) ?? a.components[0];
      if (!target) return `${head}\n\n(no component brief available)`;
      return `${head}

**${target.label}** (${target.kind})
${target.brief}

Implementation instruction:
${target.prompt}`;
    }
  }
}

export function compose(request: ComposeRequest): ComposedPrompt {
  const loaded: Loaded[] = [];
  for (const pick of request.picks) {
    const analysis = effectiveAnalysis(pick.slug);
    if (analysis) loaded.push({ pick, analysis });
  }
  if (loaded.length === 0) {
    throw new Error("None of the selected slugs exist in the library.");
  }

  const conflicts = detectConflicts(loaded);
  const blocking = conflicts.filter((c) => c.severity === "incompatible");

  const header =
    request.mode === "restyle"
      ? `Restyle my existing code into a composed design language. Do not change behaviour, structure, routing, or copy — change only the visual language. Where my markup can't express a required decision, add the minimum structure needed and say what you added.`
      : request.mode === "component"
        ? `Build a single component in a composed design language. Content-agnostic: it must work with whatever content it is given.`
        : `Build a full page in a composed design language.`;

  const intent = request.intent.trim()
    ? `\n## What I'm building\n${request.intent.trim()}\n`
    : "";

  const roster = loaded
    .map(
      (l) =>
        `- \`${l.pick.slug}\` → **${l.pick.role}**${l.pick.detail ? ` (${l.pick.detail})` : ""} — ${l.analysis.identity.dna}`,
    )
    .join("\n");

  const resolutions = conflicts.length
    ? `\n## Resolved conflicts — these decisions are already made, follow them
${conflicts
  .map(
    (c, i) =>
      `${i + 1}. **${c.dimension}** ${c.severity === "incompatible" ? "⚠ genuinely incompatible" : c.severity === "warning" ? "— needs care" : "— minor"}\n   Problem: ${c.description}\n   **Resolution: ${c.resolution}**`,
  )
  .join("\n\n")}
${
  blocking.length
    ? `\n> ${blocking.length} of these are genuine incompatibilities, not stylistic wobbles. The resolutions above pick a winner. If you disagree with a call, say so before building rather than blending the two.`
    : ""
}\n`
    : "";

  // Anti-patterns are unioned across picks: something that breaks any
  // contributing language breaks the composition.
  const antiPatterns = [...new Set(loaded.flatMap((l) => l.analysis.antiPatterns))];
  const philosophy = [
    ...new Set(loaded.flatMap((l) => l.analysis.philosophy.slice(0, 3))),
  ];

  // Contrast check on the winning palette — a composed prompt that silently
  // produces unreadable text is worse than no prompt.
  const colorOwner =
    loaded.find((l) => l.pick.role === "color")?.analysis ?? loaded[0]!.analysis;
  const ground = colorOwner.color.palette.find((p) => p.role === "ground");
  const ink = colorOwner.color.palette.find((p) => p.role === "ink");
  const contrastNote =
    ground && ink
      ? `\nMeasured contrast of the chosen ink on the chosen ground: ${contrastRatio(ink.hex, ground.hex).toFixed(2)}:1.${
          contrastRatio(ink.hex, ground.hex) < 4.5
            ? " That is below WCAG AA for body text — darken the ink or lighten the ground for running text, and reserve the original pairing for large display type."
            : ""
        }\n`
      : "";

  const prompt = `${header}
${intent}
## Sources — each contributes only its assigned role
${roster}

Do not import anything from a source outside its assigned role. If \`${loaded[0]!.pick.slug}\` owns typography, its colours are irrelevant here.
This is a design system to apply, not a page to reproduce. Never copy the sources' copy, brand, imagery or subject matter.
${resolutions}
## Composed specification

${loaded.map(contribution).join("\n\n")}
${contrastNote}
## Principles
${philosophy.map((p) => `- ${p}`).join("\n")}

## Do NOT
${antiPatterns.map((p) => `- ${p}`).join("\n")}

## Quality bar
- One type scale and one spacing scale across the whole build.
- One easing family. Motion is purposeful or absent.
- Tabular numerals for anything numeric.
- Real focus states, labels and roles. Contrast meets WCAG AA for body text.
- No layout shift.${
    request.mode === "restyle"
      ? "\n- Preserve every existing behaviour, prop and test. Restyle only."
      : ""
  }
`;

  for (const l of loaded) recordUse(l.pick.slug);

  return ComposedPrompt.parse({
    prompt,
    conflicts,
    picks: loaded.map((l) => l.pick),
    mode: request.mode,
  });
}

/**
 * A collection's "house style": the shared language across its members,
 * derived from what they agree on rather than by averaging.
 */
export function houseStyle(name: string, slugs: string[]): string {
  const analyses = slugs
    .map((s) => effectiveAnalysis(s))
    .filter((a): a is Analysis => a !== null);
  if (analyses.length === 0) return `Collection "${name}" is empty.`;

  const mode = <T extends string>(values: T[]): T => {
    const counts = new Map<T, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  };

  const family = mode(analyses.map((a) => a.styleMood.family));
  const density = mode(analyses.map((a) => a.layout.density));
  const motion = mode(analyses.map((a) => a.motion.intensity));

  // Shared tokens are the ones that recur — a colour used once is that
  // entry's flourish, not the collection's house style.
  const threshold = Math.max(2, Math.ceil(analyses.length / 2));
  const tally = (items: string[]) => {
    const m = new Map<string, number>();
    for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
    return [...m.entries()]
      .filter(([, n]) => n >= threshold)
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k);
  };

  const sharedMoods = tally(analyses.flatMap((a) => a.styleMood.moods));
  const sharedTags = tally(analyses.flatMap((a) => a.tags));
  const sharedPrinciples = tally(analyses.flatMap((a) => a.philosophy));

  const grounds = analyses
    .map((a) => a.color.palette.find((p) => p.role === "ground")?.hex)
    .filter(Boolean) as string[];
  const accents = analyses
    .map((a) => a.color.palette.find((p) => p.role === "accent")?.hex)
    .filter(Boolean) as string[];

  return `# House style — ${name}

Derived from ${analyses.length} references: ${analyses.map((a) => a.identity.name).join(", ")}.

**The through-line:** ${family}, ${density} density, ${motion} motion.${
    sharedMoods.length ? ` Consistently ${sharedMoods.join(", ")}.` : ""
  }

## Shared decisions
- Style family: **${family}**
- Density: **${density}** — ${analyses.find((a) => a.layout.density === density)!.layout.spacingRhythm}
- Motion: **${motion}** — ${analyses.find((a) => a.motion.intensity === motion)!.motion.easingCharacter}
- Type: ${analyses[0]!.typography.pairingIntent}
${sharedTags.length ? `- Recurring: ${sharedTags.join(", ")}` : ""}

## Colour range across the collection
Grounds: ${[...new Set(grounds)].join(", ") || "—"}
Accents: ${[...new Set(accents)].join(", ") || "—"}

Pick one ground and one accent and commit; the range above is the acceptable
territory, not a palette to use all of at once.

## Principles this collection agrees on
${sharedPrinciples.length ? sharedPrinciples.map((p) => `- ${p}`).join("\n") : analyses[0]!.philosophy.map((p) => `- ${p}`).join("\n")}

## Do NOT
${[...new Set(analyses.flatMap((a) => a.antiPatterns))].map((p) => `- ${p}`).join("\n")}
`;
}
