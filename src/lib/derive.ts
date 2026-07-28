/**
 * Analysis -> the three copy-ready artifacts. Deterministic string building,
 * no second model call: artifacts must regenerate instantly whenever a human
 * edits a field, and must never drift from the stored analysis.
 */
import type { Analysis, Artifacts, Swatch } from "./schema.ts";
import { contrastRatio } from "./color.ts";

const CSS_VAR: Record<Swatch["role"], string> = {
  ground: "--ground",
  surface: "--surface",
  ink: "--ink",
  "ink-muted": "--ink-muted",
  accent: "--accent",
  "accent-secondary": "--accent-2",
  subtle: "--subtle",
  border: "--border",
};

const bullets = (items: string[]) => items.map((i) => `- ${i}`).join("\n");

export function buildBrief(a: Analysis): string {
  const p = a.color.palette;
  const ground = p.find((s) => s.role === "ground")?.hex ?? "#ffffff";

  return `# ${a.identity.name}

> ${a.identity.dna}

**Why it works.** ${a.identity.whyItWorks}

## Style & mood
${a.styleMood.family}${a.styleMood.secondaryFamily ? ` x ${a.styleMood.secondaryFamily}` : ""} — ${a.styleMood.moods.join(", ")}
Era/vibe: ${a.styleMood.era}
Brand personality: ${a.styleMood.brandPersonality}

## Typography
${a.typography.pairingIntent}

- Scale: ${a.typography.scaleRatio}
- Weights: ${a.typography.weights.join(", ") || "—"}
- Tracking & leading: ${a.typography.trackingLeading}
- Casing: ${a.typography.casingHabits}

Font candidates (screenshot inference — treat certainty honestly):
${
  a.typography.fontCandidates
    .map(
      (f) =>
        `- **${f.name}** (${f.role}, ${f.certainty}) → \`${f.fallbackStack}\``,
    )
    .join("\n") || "- none identified"
}

## Colour
${
  p
    .map(
      (s) =>
        `- \`${s.hex}\` **${s.role}** — ${(s.weight * 100).toFixed(1)}% coverage, ${contrastRatio(s.hex, ground).toFixed(2)}:1 vs ground${s.note ? ` — ${s.note}` : ""}`,
    )
    .join("\n")
}

${a.color.paletteRationale}

Contrast: ${a.color.contrastNotes}

## Layout & space
- Grid: ${a.layout.grid}
- Columns: ${a.layout.columnLogic}
- Spacing rhythm: ${a.layout.spacingRhythm}
- Density: **${a.layout.density}**
- Alignment: ${a.layout.alignmentDiscipline}
- Breakpoints: ${a.layout.breakpointBehaviour}
- Section pacing: ${a.layout.sectionPacing}

## Surface & depth
- Radius: ${a.surface.radiusLanguage}
- Borders: ${a.surface.borderLanguage}
- Shadow: ${a.surface.shadowPhilosophy}
- Treatments: ${a.surface.treatments.join(", ") || "none"}

## Motion — ${a.motion.intensity}
- Transitions: ${a.motion.transitions}
- Easing: ${a.motion.easingCharacter}
- Durations: ${a.motion.durations}
- Scroll: ${a.motion.scrollBehaviour}
- Hover/press: ${a.motion.hoverPress}
- Entrance: ${a.motion.entranceChoreography}

## UX patterns
- Hierarchy: ${a.ux.hierarchyStrategy}
- CTA logic: ${a.ux.ctaLogic}
- Density decisions: ${a.ux.densityDecisions}
- Accessibility: ${a.ux.accessibilityObservations}

## Components
${a.components.map((c) => `### ${c.label} (${c.kind})\n${c.brief}`).join("\n\n")}

## Design philosophy
${bullets(a.philosophy)}

## Anti-patterns — do NOT carry these over
${bullets(a.antiPatterns)}

## Implementation
- Approach: ${a.implementation.cssApproach}
- Difficulty: **${a.implementation.difficulty}**
- Gotchas:
${bullets(a.implementation.gotchas.length ? a.implementation.gotchas : ["none noted"])}
`;
}

export function buildTokenSet(a: Analysis): string {
  const seen = new Set<string>();
  const vars = a.color.palette
    .filter((s) => {
      const v = CSS_VAR[s.role];
      if (seen.has(v)) return false;
      seen.add(v);
      return true;
    })
    .map((s) => `    ${CSS_VAR[s.role]}: ${s.hex};`)
    .join("\n");

  const fonts = a.typography.fontCandidates.reduce<Record<string, string>>(
    (acc, f) => {
      if (!acc[f.role]) acc[f.role] = f.fallbackStack;
      return acc;
    },
    {},
  );

  return `/* ${a.identity.name} — ${a.identity.dna}
   Fonts are best-effort inference from a screenshot. Swap in the real face
   if you know it; the fallback stacks below are chosen to sit close. */
@theme {
${vars}

    --font-display: ${fonts.display ?? "Georgia, 'Times New Roman', serif"};
    --font-body: ${fonts.body ?? "system-ui, -apple-system, sans-serif"};
    --font-mono: ${fonts.mono ?? "ui-monospace, 'SF Mono', Menlo, monospace"};

    /* scale: ${a.typography.scaleRatio} */
    /* density: ${a.layout.density} — ${a.layout.spacingRhythm} */
    /* motion: ${a.motion.intensity} — ${a.motion.durations}, ${a.motion.easingCharacter} */
}

${a.implementation.tailwindTokens}
`;
}

export function buildClaudePrompt(a: Analysis): string {
  const p = a.color.palette;
  return `Build using the "${a.identity.name}" design language (${a.identity.dna}).

This is a design SYSTEM, not a page to copy. Apply it to whatever content you are
given. Do not reproduce the original's copy, brand, imagery, or subject matter.

## Core idea
${a.identity.whyItWorks}

## Principles (apply these to unrelated content)
${bullets(a.philosophy)}

## Style
${a.styleMood.family}${a.styleMood.secondaryFamily ? ` crossed with ${a.styleMood.secondaryFamily}` : ""}. Mood: ${a.styleMood.moods.join(", ")}.
Personality: ${a.styleMood.brandPersonality}

## Colour — use these exact values
${p.map((s) => `${s.role}: ${s.hex}`).join("\n")}

${a.color.paletteRationale}
Contrast: ${a.color.contrastNotes}

## Typography
${a.typography.pairingIntent}
Scale ${a.typography.scaleRatio}. Weights ${a.typography.weights.join(", ") || "as needed"}.
Tracking/leading: ${a.typography.trackingLeading}
Casing: ${a.typography.casingHabits}
Faces: ${a.typography.fontCandidates.map((f) => `${f.role} → ${f.fallbackStack}`).join(" | ") || "sensible system stacks"}

## Layout
${a.layout.grid}. ${a.layout.columnLogic}
Spacing rhythm: ${a.layout.spacingRhythm}
Density: ${a.layout.density}. Alignment: ${a.layout.alignmentDiscipline}
Responsive: ${a.layout.breakpointBehaviour}
Section pacing: ${a.layout.sectionPacing}

## Surface
Radius: ${a.surface.radiusLanguage}
Borders: ${a.surface.borderLanguage}
Shadow: ${a.surface.shadowPhilosophy}
Treatments: ${a.surface.treatments.join(", ") || "none — keep surfaces flat"}

## Motion (${a.motion.intensity})
${a.motion.transitions}
Easing ${a.motion.easingCharacter}, durations ${a.motion.durations}.
Scroll: ${a.motion.scrollBehaviour}
Hover/press: ${a.motion.hoverPress}
Entrance: ${a.motion.entranceChoreography}
Respect prefers-reduced-motion.

## UX
Hierarchy: ${a.ux.hierarchyStrategy}
CTAs: ${a.ux.ctaLogic}
Density: ${a.ux.densityDecisions}
Accessibility: ${a.ux.accessibilityObservations}

## Do NOT
${bullets(a.antiPatterns)}

## Implementation notes
${a.implementation.cssApproach}
${a.implementation.gotchas.length ? `Watch out for:\n${bullets(a.implementation.gotchas)}` : ""}

Tokens:
${a.implementation.tailwindTokens}
`;
}

export const buildArtifacts = (a: Analysis): Artifacts => ({
  brief: buildBrief(a),
  claudePrompt: buildClaudePrompt(a),
  tokenSet: buildTokenSet(a),
});

/**
 * Completeness x confidence. Deliberately punishes thin arrays and
 * hedged fonts — a high score should mean "trust this without checking".
 */
export function qualityScore(a: Analysis): number {
  const confidences = [
    a.identity.confidence,
    a.styleMood.confidence,
    a.typography.confidence,
    a.color.confidence,
    a.layout.confidence,
    a.surface.confidence,
    a.motion.confidence,
    a.ux.confidence,
    a.implementation.confidence,
  ];
  const avgConfidence =
    confidences.reduce((s, c) => s + c, 0) / confidences.length;

  const completeness =
    [
      a.components.length >= 3,
      a.philosophy.length >= 3,
      a.antiPatterns.length >= 2,
      a.tags.length >= 5,
      a.typography.fontCandidates.length >= 2,
      a.color.palette.length >= 4,
      a.implementation.gotchas.length >= 1,
      a.implementation.tailwindTokens.length > 80,
    ].filter(Boolean).length / 8;

  // Two thirds confidence, one third coverage — a confident but sparse
  // analysis is still not something to build from unchecked.
  return Math.round((avgConfidence * 0.66 + completeness * 0.34) * 100) / 100;
}
