/**
 * Screenshot → validated Analysis, and query → retrieval terms.
 *
 * This module has no idea which provider answers. It asks `askJson` for a
 * shape and gets one back, or an error naming every provider that failed.
 */
import { z } from "zod";
import { askJson } from "./ai/index.ts";
import { Analysis, Slug, type Swatch } from "./schema.ts";
import { contrastRatio } from "./color.ts";

const SYSTEM = `You are Atlas, a design analyst. You turn a screenshot of a website or UI into a
structured, reusable design brief that another AI can build from WITHOUT ever seeing the image.

Your output is judged on one thing: could a competent engineer, given only your JSON, rebuild
this design language applied to COMPLETELY DIFFERENT CONTENT and have it feel right?

Rules that matter more than completeness:

1. TRANSFERABLE, NOT PIXEL-COPIED. Never describe the specific copy, brand, product, or imagery
   as something to reproduce. Describe the *system*: the relationships, ratios, rhythms and
   decisions. "Display serif at ~4.5x body, tight tracking, generous leading" transfers.
   "The headline says 'The AI workspace'" does not. Never name the source brand as something
   to imitate; name the technique.
2. EXPLAIN WHY IT WORKS, not what is present. Anyone can list "there is a navbar". You explain
   why the navbar reads as premium: the hairline weight, the optical centering, the restraint.
3. BE HONEST ABOUT FONTS. You cannot identify a typeface from a screenshot with certainty.
   Use certainty "identified" only for genuinely unmistakable faces. Otherwise "likely" or
   "guess", and always give a real fallback stack that gets close. Never invent a font as fact.
4. USE THE MEASURED PALETTE. Hex values are supplied below, extracted programmatically via
   k-means. Reason about those actual values. Do not invent hex codes.
5. CONFIDENCE IS A SIGNAL, NOT A FORMALITY. A screenshot showing no motion cannot support high
   motion confidence. Score honestly; low scores tell the user what to verify.
6. PHILOSOPHY MUST BE PORTABLE. Write each principle so it could be applied to a totally
   unrelated product. "Let one element be loud so everything else can be quiet" is portable.
   "Use a tree illustration" is not.
7. ANTI-PATTERNS ARE REQUIRED. State what would break if this language were misapplied, and
   what a naive imitator would wrongly copy.
8. COMPONENTS GET STANDALONE PROMPTS. Each component's prompt must work pasted alone, with no
   surrounding context, and must be content-agnostic.
9. searchText is prose written for retrieval: pack in the vocabulary someone would plausibly
   search for — moods, comparisons, use cases, adjacent industries, technique names.
10. The slug is a stable human handle (kebab-case, 2-4 words, e.g. "apple-glass-nav").
    Make it specific and memorable; it is how a human will refer to this forever.`;

function paletteBlock(palette: Swatch[]): string {
  const ground = palette.find((p) => p.role === "ground")?.hex ?? "#ffffff";
  const lines = palette.map((p) => {
    const ratio = contrastRatio(p.hex, ground).toFixed(2);
    return `- ${p.hex}  role=${p.role}  coverage=${(p.weight * 100).toFixed(1)}%  contrast-vs-ground=${ratio}:1`;
  });
  return `MEASURED PALETTE (k-means over the actual pixels — these are the real colours):
${lines.join("\n")}

Roles above are a programmatic first pass. If the image clearly contradicts one, correct it in
your output and say why in paletteRationale. Reuse these exact hex values.`;
}

export type AnalyzeInput = {
  base64Png: string;
  palette: Swatch[];
  sourceUrl: string | null;
  filename: string | null;
  /** Slugs already in the library, so the model doesn't collide. */
  takenSlugs: string[];
  /** Optional human steer on a re-analysis. */
  hint?: string;
};

export type AnalyzeOutput = {
  analysis: Analysis;
  /** Recorded against the analysis version, e.g. "groq/qwen3-vl-32b". */
  modelLabel: string;
};

export async function analyzeScreenshot(
  input: AnalyzeInput,
): Promise<AnalyzeOutput> {
  const context = [
    paletteBlock(input.palette),
    input.sourceUrl ? `SOURCE URL: ${input.sourceUrl}` : null,
    input.filename ? `FILENAME: ${input.filename}` : null,
    input.takenSlugs.length
      ? `SLUGS ALREADY TAKEN (pick something different): ${input.takenSlugs.join(", ")}`
      : null,
    input.hint ? `HUMAN NOTE — weight this heavily: ${input.hint}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await askJson({
    system: SYSTEM,
    prompt: `${context}\n\nAnalyse this design and produce the structured brief.`,
    image: { base64: input.base64Png, mime: "image/png" },
    schema: Analysis,
    schemaName: "DesignAnalysis",
    maxOutputTokens: 16000,
    temperature: 0.3,
  });

  return {
    analysis: normaliseSlug(result.data, input.takenSlugs),
    modelLabel: `${result.provider}/${result.model}`,
  };
}

/** Guarantee slug validity and uniqueness even if the model drifts. */
function normaliseSlug(analysis: Analysis, taken: string[]): Analysis {
  let base = analysis.identity.slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  if (!Slug.safeParse(base).success) base = "inspiration";

  let slug = base;
  let n = 2;
  while (taken.includes(slug)) slug = `${base}-${n++}`;

  return { ...analysis, identity: { ...analysis.identity, slug } };
}

/* ------------------------------------------------------------------ */
/* Query expansion                                                     */
/* ------------------------------------------------------------------ */

const Expansion = z.object({
  keywords: z.array(z.string()).max(14),
  families: z.array(
    z.enum([
      "minimal", "editorial", "brutalist", "glass", "neo-classical",
      "technical", "playful", "luxury", "retro", "organic",
      "data-dense", "illustrated",
    ]),
  ),
  moods: z.array(z.string()).max(8),
  density: z.array(z.enum(["airy", "balanced", "dense"])),
  motion: z.array(z.enum(["still", "restrained", "lively", "cinematic"])),
});

export type ExpandedQuery = z.infer<typeof Expansion>;

const EMPTY: ExpandedQuery = {
  keywords: [],
  families: [],
  moods: [],
  density: [],
  motion: [],
};

/**
 * Natural language → retrieval terms, so "something calm for a fintech
 * landing page" reaches the BM25 index as words that occur in the corpus.
 *
 * Failure is deliberately non-fatal: search falls back to the raw query
 * rather than blocking on a provider. This runs on the ⌘K path, so it is a
 * text-capability request and lands on the fastest available model.
 */
export async function expandQuery(q: string): Promise<ExpandedQuery> {
  if (!q.trim()) return EMPTY;

  try {
    const result = await askJson({
      system:
        "Expand a design-library search query into retrieval terms. Return only terms that " +
        "would plausibly appear in prose describing a design's style, mood, typography, " +
        "layout, or motion. Include synonyms and technique names. Do not invent brand names.",
      prompt: q,
      schema: Expansion,
      schemaName: "QueryExpansion",
      maxOutputTokens: 700,
      temperature: 0.4,
    });
    return result.data;
  } catch {
    return EMPTY;
  }
}
