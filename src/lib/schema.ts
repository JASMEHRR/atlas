/**
 * Atlas — single source of truth.
 *
 * Every boundary (Claude vision output, REST API, MCP tools, DB read/write,
 * import bundles) validates against these schemas. Types are derived, never
 * hand-written, so a schema change is a compile error everywhere it matters.
 */
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

/** 0..1. Every AI-authored group carries one so weak analysis is visible. */
export const Confidence = z.number().min(0).max(1);

export const Slug = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be kebab-case");

export const Hex = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i, "must be a #rrggbb hex colour");

/** Roles are assigned programmatically from the k-means result, then the
 *  model reasons about them. Fixed vocabulary keeps token export stable. */
export const ColorRole = z.enum([
  "ground",
  "surface",
  "ink",
  "ink-muted",
  "accent",
  "accent-secondary",
  "subtle",
  "border",
]);
export type ColorRole = z.infer<typeof ColorRole>;

export const Swatch = z.object({
  hex: Hex,
  role: ColorRole,
  /** Share of sampled pixels, 0..1. Programmatic — never model-authored. */
  weight: z.number().min(0).max(1),
  note: z.string().max(200).default(""),
});
export type Swatch = z.infer<typeof Swatch>;

/* ------------------------------------------------------------------ */
/* Controlled vocabularies                                             */
/* ------------------------------------------------------------------ */

export const StyleFamily = z.enum([
  "minimal",
  "editorial",
  "brutalist",
  "glass",
  "neo-classical",
  "technical",
  "playful",
  "luxury",
  "retro",
  "organic",
  "data-dense",
  "illustrated",
]);
export type StyleFamily = z.infer<typeof StyleFamily>;

export const Density = z.enum(["airy", "balanced", "dense"]);
export const MotionIntensity = z.enum(["still", "restrained", "lively", "cinematic"]);
export const Difficulty = z.enum(["trivial", "moderate", "involved", "hard"]);

export const ComponentKind = z.enum([
  "navbar",
  "hero",
  "footer",
  "card",
  "pricing-table",
  "form",
  "button",
  "modal",
  "sidebar",
  "table",
  "testimonial",
  "feature-grid",
  "cta-band",
  "stat-block",
  "gallery",
  "chart",
  "empty-state",
  "other",
]);
export type ComponentKind = z.infer<typeof ComponentKind>;

/** Roles a pick can take on a Mixboard. Drives conflict detection. */
export const MixRole = z.enum([
  "navigation",
  "hero",
  "typography",
  "color",
  "layout",
  "motion",
  "surface",
  "component",
  "voice",
]);
export type MixRole = z.infer<typeof MixRole>;

/* ------------------------------------------------------------------ */
/* Analysis sections                                                   */
/* ------------------------------------------------------------------ */

const section = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ ...shape, confidence: Confidence });

export const Identity = section({
  name: z.string().min(1).max(80),
  /** Exactly the interface between the human and Claude Code. */
  slug: Slug,
  /** One sentence. Why this works, not what it contains. */
  whyItWorks: z.string().min(20).max(400),
  /** 3-6 words. The card subtitle, e.g. "warm editorial x print DNA". */
  dna: z.string().min(3).max(60),
});

export const StyleMood = section({
  family: StyleFamily,
  secondaryFamily: StyleFamily.nullable(),
  moods: z.array(z.string().max(30)).min(2).max(8),
  era: z.string().max(80),
  brandPersonality: z.string().max(300),
});

export const FontCandidate = z.object({
  name: z.string().max(60),
  /** Honesty gate: the prompt forbids asserting a font as fact. */
  certainty: z.enum(["identified", "likely", "guess"]),
  fallbackStack: z.string().max(200),
  role: z.enum(["display", "body", "mono", "accent"]),
});

export const Typography = section({
  pairingIntent: z.string().max(400),
  scaleRatio: z.string().max(40),
  weights: z.array(z.string().max(30)).max(8),
  trackingLeading: z.string().max(300),
  casingHabits: z.string().max(300),
  fontCandidates: z.array(FontCandidate).max(8),
});

export const Color = section({
  palette: z.array(Swatch).min(1).max(12),
  contrastNotes: z.string().max(400),
  /** How the palette creates the feeling — the transferable part. */
  paletteRationale: z.string().max(500),
});

export const Layout = section({
  grid: z.string().max(200),
  columnLogic: z.string().max(300),
  spacingRhythm: z.string().max(300),
  density: Density,
  alignmentDiscipline: z.string().max(300),
  breakpointBehaviour: z.string().max(400),
  sectionPacing: z.string().max(400),
});

export const Surface = section({
  radiusLanguage: z.string().max(250),
  borderLanguage: z.string().max(250),
  shadowPhilosophy: z.string().max(300),
  treatments: z.array(z.string().max(40)).max(10),
});

export const ComponentBrief = z.object({
  kind: ComponentKind,
  label: z.string().max(60),
  /** Dense micro-brief: how to rebuild this one part. */
  brief: z.string().min(20).max(1200),
  /** Standalone, content-agnostic, copyable. */
  prompt: z.string().min(20).max(2500),
  confidence: Confidence,
});
export type ComponentBrief = z.infer<typeof ComponentBrief>;

export const Motion = section({
  transitions: z.string().max(400),
  easingCharacter: z.string().max(200),
  durations: z.string().max(200),
  scrollBehaviour: z.string().max(300),
  hoverPress: z.string().max(300),
  entranceChoreography: z.string().max(400),
  intensity: MotionIntensity,
});

export const UxPatterns = section({
  hierarchyStrategy: z.string().max(400),
  ctaLogic: z.string().max(400),
  densityDecisions: z.string().max(400),
  accessibilityObservations: z.string().max(500),
});

export const Implementation = section({
  tailwindTokens: z.string().max(2000),
  cssApproach: z.string().max(500),
  difficulty: Difficulty,
  gotchas: z.array(z.string().max(300)).max(10),
});

/** The full model output. One structured Claude call fills exactly this. */
export const Analysis = z.object({
  identity: Identity,
  styleMood: StyleMood,
  typography: Typography,
  color: Color,
  layout: Layout,
  surface: Surface,
  components: z.array(ComponentBrief).min(1).max(20),
  motion: Motion,
  ux: UxPatterns,
  /** Principles stated so they apply to unrelated content. */
  philosophy: z.array(z.string().min(10).max(400)).min(2).max(10),
  /** What NOT to carry over, and what breaks if misapplied. */
  antiPatterns: z.array(z.string().min(10).max(400)).min(1).max(10),
  implementation: Implementation,
  tags: z.array(z.string().max(40)).min(3).max(24),
  /** Prose blob the FTS index is built from. Model-authored, search-oriented. */
  searchText: z.string().min(50).max(4000),
});
export type Analysis = z.infer<typeof Analysis>;

/** Section keys a human can override. Overrides outrank AI text forever. */
export const OverridableField = z.enum([
  "identity.name",
  "identity.whyItWorks",
  "identity.dna",
  "styleMood.family",
  "styleMood.moods",
  "typography.pairingIntent",
  "color.paletteRationale",
  "layout.density",
  "motion.intensity",
  "implementation.difficulty",
  "implementation.tailwindTokens",
  "philosophy",
  "antiPatterns",
  "tags",
]);
export type OverridableField = z.infer<typeof OverridableField>;

/* ------------------------------------------------------------------ */
/* Derived artifacts                                                   */
/* ------------------------------------------------------------------ */

export const Artifacts = z.object({
  /** Dense human-readable markdown. */
  brief: z.string(),
  /** Full reusable implementation instruction, content-agnostic. */
  claudePrompt: z.string(),
  /** Paste-ready Tailwind theme + CSS custom properties. */
  tokenSet: z.string(),
});
export type Artifacts = z.infer<typeof Artifacts>;

/* ------------------------------------------------------------------ */
/* Records                                                             */
/* ------------------------------------------------------------------ */

export const Provenance = z.object({
  sourceUrl: z.string().url().nullable(),
  capturedAt: z.string(),
  captureKind: z.enum(["full-page", "component", "unknown"]),
  originalFilename: z.string().nullable(),
});
export type Provenance = z.infer<typeof Provenance>;

export const Inspiration = z.object({
  slug: Slug,
  analysis: Analysis,
  artifacts: Artifacts,
  provenance: Provenance,
  imagePath: z.string(),
  thumbPath: z.string(),
  sha256: z.string().length(64),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** 0..1 completeness+confidence. Nudges the human to verify weak entries. */
  qualityScore: z.number().min(0).max(1),
  humanVerified: z.boolean(),
  useCount: z.number().int().min(0),
  analysisVersion: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
  notes: z.string(),
  collections: z.array(z.string()),
});
export type Inspiration = z.infer<typeof Inspiration>;

/* ------------------------------------------------------------------ */
/* Jobs                                                                */
/* ------------------------------------------------------------------ */

export const STAGES = ["ingest", "vision", "derive", "index", "review"] as const;
export const Stage = z.enum(STAGES);
export type Stage = z.infer<typeof Stage>;

export const StageStatus = z.enum(["pending", "running", "done", "failed"]);

export const JobStage = z.object({
  stage: Stage,
  status: StageStatus,
  error: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});

export const Job = z.object({
  id: z.string(),
  label: z.string(),
  slug: Slug.nullable(),
  stages: z.array(JobStage),
  status: z.enum(["running", "done", "failed", "awaiting-review"]),
  createdAt: z.string(),
});
export type Job = z.infer<typeof Job>;

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

export const Facets = z.object({
  family: z.array(StyleFamily).default([]),
  moods: z.array(z.string()).default([]),
  components: z.array(ComponentKind).default([]),
  /** Hex from the swatch picker; matched by perceptual distance. */
  color: Hex.nullable().default(null),
  density: z.array(Density).default([]),
  motion: z.array(MotionIntensity).default([]),
  difficulty: z.array(Difficulty).default([]),
  collection: z.string().nullable().default(null),
  verifiedOnly: z.boolean().default(false),
});
export type Facets = z.infer<typeof Facets>;

export const SearchQuery = z.object({
  q: z.string().default(""),
  facets: Facets.default(Facets.parse({})),
  limit: z.number().int().min(1).max(200).default(60),
  /** Off for the grid (cheap), on for ⌘K natural language. */
  expand: z.boolean().default(false),
});
export type SearchQuery = z.infer<typeof SearchQuery>;

export const SearchHit = z.object({
  slug: Slug,
  name: z.string(),
  dna: z.string(),
  whyItWorks: z.string(),
  thumbPath: z.string(),
  family: StyleFamily,
  tags: z.array(z.string()),
  palette: z.array(Swatch),
  qualityScore: z.number(),
  humanVerified: z.boolean(),
  score: z.number(),
  /** Why this hit ranked — shown in the palette, keeps search legible. */
  matchedOn: z.array(z.string()),
});
export type SearchHit = z.infer<typeof SearchHit>;

/* ------------------------------------------------------------------ */
/* Mixboard / Recipes                                                  */
/* ------------------------------------------------------------------ */

export const MixPick = z.object({
  slug: Slug,
  role: MixRole,
  /** Optional narrowing, e.g. which component to take. */
  detail: z.string().max(120).default(""),
});
export type MixPick = z.infer<typeof MixPick>;

export const OutputMode = z.enum(["full-page", "component", "restyle"]);
export type OutputMode = z.infer<typeof OutputMode>;

export const ComposeRequest = z.object({
  picks: z.array(MixPick).min(1).max(12),
  mode: OutputMode.default("full-page"),
  /** Free-text brief the composed prompt is written against. */
  intent: z.string().max(600).default(""),
});
export type ComposeRequest = z.infer<typeof ComposeRequest>;

export const Conflict = z.object({
  dimension: z.enum(["color", "density", "motion", "typography", "surface"]),
  severity: z.enum(["note", "warning", "incompatible"]),
  between: z.array(Slug).min(2),
  description: z.string(),
  /** Never concatenate — always state the resolution taken. */
  resolution: z.string(),
});
export type Conflict = z.infer<typeof Conflict>;

export const ComposedPrompt = z.object({
  prompt: z.string(),
  conflicts: z.array(Conflict),
  picks: z.array(MixPick),
  mode: OutputMode,
});
export type ComposedPrompt = z.infer<typeof ComposedPrompt>;

export const Recipe = z.object({
  id: z.string(),
  name: z.string().min(1).max(80),
  version: z.number().int().positive(),
  request: ComposeRequest,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Recipe = z.infer<typeof Recipe>;

/* ------------------------------------------------------------------ */
/* Export bundle                                                       */
/* ------------------------------------------------------------------ */

export const Bundle = z.object({
  atlasVersion: z.literal(1),
  exportedAt: z.string(),
  inspirations: z.array(Inspiration),
  recipes: z.array(Recipe),
  /** filename -> base64. Keeps the bundle a single portable file. */
  images: z.record(z.string(), z.string()),
});
export type Bundle = z.infer<typeof Bundle>;
