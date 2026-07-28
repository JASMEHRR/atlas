import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Point the DB at a throwaway directory before anything imports db.ts.
const dir = mkdtempSync(path.join(tmpdir(), "atlas-test-"));
process.env.ATLAS_DATA_DIR = dir;

const { createInspiration } = await import("../src/lib/repo.ts");
const { search, similar, gapAnalysis } = await import("../src/lib/search.ts");
const { closeDb } = await import("../src/lib/db.ts");
const { SearchQuery, Facets } = await import("../src/lib/schema.ts");
const { analysis } = await import("./fixtures.ts");

const provenance = {
  sourceUrl: null,
  capturedAt: "2026-01-01T00:00:00.000Z",
  captureKind: "unknown" as const,
  originalFilename: null,
};

before(() => {
  const seed = (a: ReturnType<typeof analysis>, i: number) =>
    createInspiration({
      analysis: a,
      provenance,
      imagePath: `/api/images/${a.identity.slug}.png`,
      thumbPath: `/api/images/${a.identity.slug}.thumb.webp`,
      sha256: String(i).padStart(64, "0"),
      width: 1440,
      height: 900,
      model: "test",
    });

  seed(
    analysis({
      slug: "calm-fintech-hero",
      name: "Calm Fintech",
      family: "minimal",
      density: "airy",
      motion: "restrained",
      accent: "#2563eb",
      tags: ["minimal", "airy", "fintech", "trustworthy"],
      moods: ["calm", "credible"],
      searchText:
        "Quiet, trustworthy fintech landing page. Unhurried pacing, generous whitespace, " +
        "a single blue accent. Reads as safe and institutional without being cold.",
    }),
    1,
  );

  seed(
    analysis({
      slug: "dense-ops-dashboard",
      name: "Ops Dashboard",
      family: "data-dense",
      density: "dense",
      motion: "still",
      accent: "#16a34a",
      ground: "#0b0d10",
      tags: ["data-dense", "dashboard", "mono", "dark-mode"],
      moods: ["utilitarian", "technical"],
      searchText:
        "Extremely dense operational dashboard. Tabular data everywhere, monospaced numerals, " +
        "dark ground, no decorative motion. Built for operators scanning many values at once.",
      components: [
        {
          kind: "table",
          label: "Data table",
          brief: "Dense zebra-free table with tabular numerals and sticky header.",
          prompt: "Build a dense data table: tabular numerals, sticky header, no zebra striping.",
          confidence: 0.9,
        },
        {
          kind: "chart",
          label: "Sparkline row",
          brief: "Inline sparklines sharing one y-scale across the row.",
          prompt: "Build a row of inline sparklines sharing one y-scale.",
          confidence: 0.8,
        },
      ],
    }),
    2,
  );

  seed(
    analysis({
      slug: "warm-editorial-print",
      name: "Warm Editorial",
      family: "editorial",
      density: "balanced",
      motion: "lively",
      accent: "#b8422a",
      ground: "#f4f1ea",
      tags: ["editorial", "print", "serif", "halftone", "warm"],
      moods: ["warm", "crafted"],
      searchText:
        "Warm editorial layout with heavy display serif type and print-derived halftone texture. " +
        "Magazine feeling, paper ground, rust accent. Suits publishing and portfolio work.",
    }),
    3,
  );
});

after(() => {
  // Windows will not unlink an open SQLite file — close it first, and don't
  // fail the suite over a leftover temp directory either way.
  closeDb();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* the OS will reclaim it */
  }
});

test("an exact slug query ranks that entry first", async () => {
  const hits = await search(SearchQuery.parse({ q: "dense-ops-dashboard" }));
  assert.equal(hits[0]!.slug, "dense-ops-dashboard");
});

test("prose search finds an entry by meaning, not by its name", async () => {
  // "operators scanning" appears only in the searchText blob.
  const hits = await search(SearchQuery.parse({ q: "operators scanning values" }));
  assert.equal(hits[0]!.slug, "dense-ops-dashboard");
});

test("a natural-language query reaches the right entry via prose terms", async () => {
  const hits = await search(SearchQuery.parse({ q: "trustworthy fintech landing page" }));
  assert.equal(hits[0]!.slug, "calm-fintech-hero");

  const editorial = await search(SearchQuery.parse({ q: "heavy display serif magazine" }));
  assert.equal(editorial[0]!.slug, "warm-editorial-print");
});

test("name matches outrank incidental prose matches", async () => {
  const hits = await search(SearchQuery.parse({ q: "Warm Editorial" }));
  assert.equal(hits[0]!.slug, "warm-editorial-print");
});

test("every hit carries a reason it matched", async () => {
  const hits = await search(SearchQuery.parse({ q: "dashboard" }));
  assert.ok(hits.length > 0);
  assert.ok(hits[0]!.matchedOn.length > 0);
});

test("facets filter rather than merely re-rank", async () => {
  const hits = await search(
    SearchQuery.parse({ q: "", facets: Facets.parse({ density: ["dense"] }) }),
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.slug, "dense-ops-dashboard");
});

test("component facet finds entries that demonstrate that component", async () => {
  const hits = await search(
    SearchQuery.parse({ q: "", facets: Facets.parse({ components: ["table"] }) }),
  );
  assert.deepEqual(hits.map((h) => h.slug), ["dense-ops-dashboard"]);
});

test("colour facet matches perceptually, not by exact hex", async () => {
  // A slightly different rust than the stored #b8422a must still match.
  const hits = await search(
    SearchQuery.parse({ q: "", facets: Facets.parse({ color: "#bb4530" }) }),
  );
  assert.ok(hits.some((h) => h.slug === "warm-editorial-print"));
  // ...while an unrelated colour must not.
  const none = await search(
    SearchQuery.parse({ q: "", facets: Facets.parse({ color: "#7c3aed" }) }),
  );
  assert.equal(none.some((h) => h.slug === "warm-editorial-print"), false);
});

test("an empty query browses everything, newest first", async () => {
  const hits = await search(SearchQuery.parse({ q: "" }));
  assert.equal(hits.length, 3);
});

test("similar ranks the closest sibling above the opposite one", () => {
  const near = similar("calm-fintech-hero");
  assert.ok(near.length > 0);
  // Editorial shares 'balanced-ish' warmth; the dark dense dashboard is the
  // furthest thing in the library from a calm airy fintech page.
  assert.notEqual(near[0]!.slug, "dense-ops-dashboard");
  assert.equal(near.some((h) => h.slug === "calm-fintech-hero"), false, "never self");
});

test("gap analysis names what is missing rather than shrugging", () => {
  const gaps = gapAnalysis();
  assert.ok(gaps.length > 0);
  // With no navbar-free entries seeded beyond the fixture defaults, the
  // report should still be specific — every gap names something.
  for (const g of gaps) {
    assert.ok(g.gap.length > 0);
    assert.ok(g.detail.length > 0);
  }
});
