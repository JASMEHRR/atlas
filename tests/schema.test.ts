import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Analysis,
  Facets,
  Slug,
  ComposeRequest,
  SearchQuery,
} from "../src/lib/schema.ts";
import { analysis } from "./fixtures.ts";
import { normaliseTag, normaliseTags } from "../src/lib/vocab.ts";
import { applyOverrides } from "../src/lib/repo.ts";

test("a well-formed analysis validates", () => {
  assert.equal(Analysis.safeParse(analysis({ slug: "a-b", name: "A" })).success, true);
});

test("slug must be kebab-case", () => {
  for (const good of ["apple-glass-nav", "linear-hero", "spade"]) {
    assert.equal(Slug.safeParse(good).success, true, good);
  }
  for (const bad of ["Apple Glass", "apple_glass", "-leading", "trailing-", "ab", "APPLE"]) {
    assert.equal(Slug.safeParse(bad).success, false, bad);
  }
});

test("analysis rejects a fabricated hex and an out-of-range confidence", () => {
  const badHex = analysis({ slug: "a-b", name: "A" });
  badHex.color.palette[0]!.hex = "rgb(0,0,0)";
  assert.equal(Analysis.safeParse(badHex).success, false);

  const badConfidence = analysis({ slug: "a-b", name: "A" });
  badConfidence.identity.confidence = 1.4;
  assert.equal(Analysis.safeParse(badConfidence).success, false);
});

test("analysis requires anti-patterns and at least one component", () => {
  const noAnti = analysis({ slug: "a-b", name: "A" });
  noAnti.antiPatterns = [];
  assert.equal(Analysis.safeParse(noAnti).success, false);

  const noComponents = analysis({ slug: "a-b", name: "A" });
  noComponents.components = [];
  assert.equal(Analysis.safeParse(noComponents).success, false);
});

test("font certainty is constrained — a model cannot invent a new confidence word", () => {
  const bad = analysis({ slug: "a-b", name: "A" });
  // @ts-expect-error deliberately invalid
  bad.typography.fontCandidates[0].certainty = "definitely";
  assert.equal(Analysis.safeParse(bad).success, false);
});

test("Facets and SearchQuery have usable empty defaults", () => {
  const f = Facets.parse({});
  assert.deepEqual(f.family, []);
  assert.equal(f.color, null);
  assert.equal(f.verifiedOnly, false);

  const q = SearchQuery.parse({});
  assert.equal(q.q, "");
  assert.equal(q.limit, 60);
  assert.equal(q.expand, false);
});

test("ComposeRequest requires at least one pick and a known role", () => {
  assert.equal(ComposeRequest.safeParse({ picks: [] }).success, false);
  assert.equal(
    ComposeRequest.safeParse({ picks: [{ slug: "a-b", role: "vibes" }] }).success,
    false,
  );
  assert.equal(
    ComposeRequest.safeParse({ picks: [{ slug: "a-b", role: "color" }] }).success,
    true,
  );
});

test("tag normalisation collapses synonyms and drops noise", () => {
  assert.equal(normaliseTag("Glassmorphism"), "glass");
  assert.equal(normaliseTag("glass morphism"), "glass");
  assert.equal(normaliseTag("Frosted Glass"), "glass");
  assert.equal(normaliseTag("MINIMALIST"), "minimal");
  assert.equal(normaliseTag("white space"), "airy");
  // Stop words carry no signal and must not enter the vocabulary.
  assert.equal(normaliseTag("design"), null);
  assert.equal(normaliseTag("modern"), null);
  assert.equal(normaliseTag(""), null);
});

test("normaliseTags dedupes across spelling variants", () => {
  const out = normaliseTags([
    "Glassmorphism",
    "glass morphism",
    "frosted",
    "minimal",
    "Minimalist",
    "website",
  ]);
  assert.deepEqual(out, ["glass", "minimal"]);
});

test("a human override replaces the AI value and survives re-validation", () => {
  const base = analysis({ slug: "a-b", name: "Original" });
  const out = applyOverrides(base, [
    { field: "identity.name", value: JSON.stringify("Corrected") },
    { field: "layout.density", value: JSON.stringify("dense") },
  ]);
  assert.equal(out.identity.name, "Corrected");
  assert.equal(out.layout.density, "dense");
  // Untouched fields are preserved exactly.
  assert.equal(out.identity.slug, "a-b");
});

test("an override that would produce an invalid analysis is discarded, not applied", () => {
  const base = analysis({ slug: "a-b", name: "Original" });
  const out = applyOverrides(base, [
    { field: "layout.density", value: JSON.stringify("extremely-dense") },
  ]);
  // Falls back to the stored analysis rather than corrupting the record.
  assert.equal(out.layout.density, "airy");
});
