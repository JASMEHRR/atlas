/**
 * Controlled vocabulary. Free-text tags from the model are normalised into a
 * canonical form and deduped, so the tag list stays useful instead of rotting
 * into "glassmorphism" / "glass-morphism" / "Glass Morphism".
 */

/** Synonyms collapse to a single canonical tag. Left side is what we accept. */
const CANONICAL: Record<string, string> = {
  glassmorphism: "glass",
  "glass morphism": "glass",
  frosted: "glass",
  "frosted glass": "glass",
  blur: "glass",
  neumorphism: "soft-ui",
  "soft ui": "soft-ui",
  monospace: "mono",
  monospaced: "mono",
  "mono type": "mono",
  serif: "serif",
  "serif type": "serif",
  "sans serif": "sans",
  "sans-serif": "sans",
  grotesk: "sans",
  grotesque: "sans",
  minimalist: "minimal",
  minimalism: "minimal",
  simple: "minimal",
  clean: "minimal",
  spacious: "airy",
  roomy: "airy",
  whitespace: "airy",
  "white space": "airy",
  gradients: "gradient",
  "gradient mesh": "gradient",
  dark: "dark-mode",
  "dark theme": "dark-mode",
  "dark ui": "dark-mode",
  light: "light-mode",
  "light theme": "light-mode",
  grain: "grain",
  noise: "grain",
  "film grain": "grain",
  halftone: "halftone",
  "halftone dots": "halftone",
  dither: "dither",
  dithered: "dither",
  brutalism: "brutalist",
  "neo brutalist": "brutalist",
  swiss: "swiss",
  "international style": "swiss",
  "editorial layout": "editorial",
  magazine: "editorial",
  "print inspired": "print",
  "print like": "print",
  typographic: "type-led",
  "type led": "type-led",
  "type driven": "type-led",
  animated: "motion",
  animation: "motion",
  microinteractions: "micro-interactions",
  "micro interactions": "micro-interactions",
  "scroll animation": "scroll-motion",
  parallax: "parallax",
  saas: "saas",
  fintech: "fintech",
  "b2b": "b2b",
  landing: "landing-page",
  "landing page": "landing-page",
  dashboard: "dashboard",
  "data heavy": "data-dense",
  "data dense": "data-dense",
};

/** Tags with no signal — they describe every design ever shipped. */
const STOP = new Set([
  "design",
  "website",
  "web",
  "ui",
  "ux",
  "modern",
  "nice",
  "good",
  "beautiful",
  "professional",
  "cool",
  "page",
  "site",
  "interface",
  "layout",
  "style",
]);

export function normaliseTag(raw: string): string | null {
  const lower = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!lower) return null;

  const mapped = CANONICAL[lower] ?? lower;
  const slug = mapped
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  if (!slug || slug.length < 2) return null;
  if (STOP.has(slug)) return null;
  return CANONICAL[slug] ?? slug;
}

export function normaliseTags(raw: string[]): string[] {
  const out = new Set<string>();
  for (const t of raw) {
    const n = normaliseTag(t);
    if (n) out.add(n);
  }
  return [...out].sort();
}
