/** A valid Analysis, minimally varied per fixture. */
import type { Analysis } from "../src/lib/schema.ts";

export function analysis(over: {
  slug: string;
  name: string;
  family?: Analysis["styleMood"]["family"];
  density?: Analysis["layout"]["density"];
  motion?: Analysis["motion"]["intensity"];
  accent?: string;
  ground?: string;
  tags?: string[];
  moods?: string[];
  searchText?: string;
  components?: Analysis["components"];
}): Analysis {
  return {
    identity: {
      name: over.name,
      slug: over.slug,
      whyItWorks:
        "Restraint everywhere except one deliberate focal point, which is what makes the page read as confident rather than busy.",
      dna: "quiet confidence x sharp accent",
      confidence: 0.9,
    },
    styleMood: {
      family: over.family ?? "minimal",
      secondaryFamily: null,
      moods: over.moods ?? ["calm", "precise"],
      era: "contemporary",
      brandPersonality: "Understated and technically credible.",
      confidence: 0.8,
    },
    typography: {
      pairingIntent: "Single grotesk carrying the whole hierarchy through weight and size alone.",
      scaleRatio: "1.25 minor third",
      weights: ["400", "600"],
      trackingLeading: "Tight tracking on display, generous 1.6 leading on body.",
      casingHabits: "Sentence case throughout; uppercase reserved for meta labels.",
      fontCandidates: [
        { name: "Inter", certainty: "likely", fallbackStack: "Inter, system-ui, sans-serif", role: "body" },
        { name: "Söhne", certainty: "guess", fallbackStack: "'Söhne', Helvetica, sans-serif", role: "display" },
      ],
      confidence: 0.6,
    },
    color: {
      palette: [
        { hex: over.ground ?? "#ffffff", role: "ground", weight: 0.6, note: "" },
        { hex: "#111111", role: "ink", weight: 0.2, note: "" },
        { hex: over.accent ?? "#2563eb", role: "accent", weight: 0.1, note: "" },
        { hex: "#f4f4f5", role: "surface", weight: 0.1, note: "" },
      ],
      contrastNotes: "Ink on ground clears AA comfortably at body sizes.",
      paletteRationale:
        "A near-monochrome field means the single accent carries all the emphasis without competing.",
      confidence: 0.85,
    },
    layout: {
      grid: "12-column, 1200px max",
      columnLogic: "Content locked to 8 columns; full-bleed reserved for imagery.",
      spacingRhythm: "8px base, sections at 96px",
      density: over.density ?? "airy",
      alignmentDiscipline: "Everything flush left to one optical edge.",
      breakpointBehaviour: "Single column below 768px; type scale drops one step.",
      sectionPacing: "Alternating tall and short sections to create breathing.",
      confidence: 0.8,
    },
    surface: {
      radiusLanguage: "8px on cards, 4px on controls",
      borderLanguage: "1px hairline at low contrast",
      shadowPhilosophy: "Almost none; separation via ground shifts",
      treatments: ["subtle-noise"],
      confidence: 0.7,
    },
    components: over.components ?? [
      {
        kind: "navbar",
        label: "Top navigation",
        brief: "Hairline-bottomed bar, optically centered links, single filled CTA on the right.",
        prompt: "Build a navigation bar: hairline bottom border, links optically centered, one filled CTA right-aligned.",
        confidence: 0.85,
      },
      {
        kind: "hero",
        label: "Hero",
        brief: "Left-aligned display headline over generous space with a single supporting line.",
        prompt: "Build a hero: left-aligned display headline, one supporting line, generous vertical space.",
        confidence: 0.8,
      },
      {
        kind: "card",
        label: "Feature card",
        brief: "Hairline bordered card, no shadow, label above title.",
        prompt: "Build a feature card: hairline border, no shadow, uppercase label above the title.",
        confidence: 0.75,
      },
    ],
    motion: {
      transitions: "Opacity and small translate on entry only.",
      easingCharacter: "Single ease-out curve",
      durations: "160-220ms",
      scrollBehaviour: "No parallax; content simply arrives.",
      hoverPress: "Border darkens; no scale.",
      entranceChoreography: "Staggered by 40ms down the page.",
      intensity: over.motion ?? "restrained",
      confidence: 0.5,
    },
    ux: {
      hierarchyStrategy: "One dominant element per viewport, everything else recedes.",
      ctaLogic: "Exactly one primary action per section.",
      densityDecisions: "Fewer things, larger, rather than more things smaller.",
      accessibilityObservations: "Focus states appear intact; contrast passes AA.",
      confidence: 0.6,
    },
    philosophy: [
      "Let one element be loud so everything else can be quiet.",
      "Space is the cheapest way to signal confidence.",
      "Consistency of alignment matters more than the specific grid chosen.",
    ],
    antiPatterns: [
      "Do not add a second accent colour; the restraint is the whole idea.",
      "Do not compress the spacing to fit more in — the airiness is load-bearing.",
    ],
    implementation: {
      tailwindTokens: "--spacing: 0.5rem;\n--radius-card: 8px;\n--max-w-content: 1200px;",
      cssApproach: "Utility classes with a small token layer.",
      difficulty: "moderate",
      gotchas: ["The hairline borders vanish on dark backgrounds without adjustment."],
      confidence: 0.8,
    },
    tags: over.tags ?? ["minimal", "airy", "type-led", "hairline", "saas"],
    searchText:
      over.searchText ??
      "A calm, minimal, airy interface with restrained motion and a single blue accent. " +
        "Suited to developer tools, SaaS landing pages and fintech products that want to read " +
        "as credible and unhurried. Typography-led hierarchy, hairline borders, no shadows.",
  };
}
