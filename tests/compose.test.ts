import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "atlas-compose-"));
process.env.ATLAS_DATA_DIR = dir;

const { createInspiration, setOverride, getInspiration } = await import(
  "../src/lib/repo.ts"
);
const { compose, houseStyle } = await import("../src/lib/compose.ts");
const { closeDb } = await import("../src/lib/db.ts");
const { buildArtifacts, qualityScore } = await import("../src/lib/derive.ts");
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
      imagePath: `/x/${a.identity.slug}.png`,
      thumbPath: `/x/${a.identity.slug}.webp`,
      sha256: String(i).padStart(64, "0"),
      width: 1440,
      height: 900,
      model: "test",
    });

  seed(
    analysis({
      slug: "airy-blue-light",
      name: "Airy Blue",
      density: "airy",
      motion: "restrained",
      accent: "#2563eb",
      ground: "#ffffff",
    }),
    1,
  );
  seed(
    analysis({
      slug: "dense-rust-dark",
      name: "Dense Rust",
      family: "data-dense",
      density: "dense",
      motion: "cinematic",
      accent: "#b8422a",
      ground: "#0b0d10",
    }),
    2,
  );
  seed(
    analysis({
      slug: "airy-blue-sibling",
      name: "Airy Blue Sibling",
      density: "airy",
      motion: "restrained",
      accent: "#2f6ae8",
      ground: "#fdfdfd",
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

test("a single pick composes without inventing conflicts", () => {
  const out = compose({
    picks: [{ slug: "airy-blue-light", role: "color", detail: "" }],
    mode: "full-page",
    intent: "",
  });
  assert.equal(out.conflicts.length, 0);
  assert.ok(out.prompt.includes("#2563eb"));
});

test("clashing picks produce conflicts, each with a stated resolution", () => {
  const out = compose({
    picks: [
      { slug: "airy-blue-light", role: "color", detail: "" },
      { slug: "dense-rust-dark", role: "layout", detail: "" },
    ],
    mode: "full-page",
    intent: "",
  });

  const dimensions = out.conflicts.map((c) => c.dimension);
  // Pin the accent clash specifically — asserting only on dimension "color"
  // would also pass on the separate light/dark ground conflict.
  assert.ok(
    out.conflicts.some(
      (c) => c.dimension === "color" && /#2563eb/.test(c.description),
    ),
    "a rust-vs-blue accent clash must be flagged",
  );
  assert.ok(dimensions.includes("density"), "airy vs dense must be flagged");
  assert.ok(dimensions.includes("motion"), "restrained vs cinematic must be flagged");

  // The whole point: never just report a clash — always resolve it.
  for (const c of out.conflicts) {
    assert.ok(c.resolution.length > 20, `${c.dimension} needs a real resolution`);
    assert.ok(c.between.length >= 2);
  }
});

test("airy vs dense is escalated to genuinely incompatible, not a soft note", () => {
  const out = compose({
    picks: [
      { slug: "airy-blue-light", role: "layout", detail: "" },
      { slug: "dense-rust-dark", role: "color", detail: "" },
    ],
    mode: "full-page",
    intent: "",
  });
  const density = out.conflicts.find((c) => c.dimension === "density")!;
  assert.equal(density.severity, "incompatible");
});

test("light and dark grounds are flagged as a structural conflict", () => {
  const out = compose({
    picks: [
      { slug: "airy-blue-light", role: "color", detail: "" },
      { slug: "dense-rust-dark", role: "surface", detail: "" },
    ],
    mode: "full-page",
    intent: "",
  });
  const ground = out.conflicts.filter((c) => c.dimension === "color");
  assert.ok(
    ground.some((c) => /ground/i.test(c.description)),
    "mixing light and dark grounds must be called out",
  );
});

test("near-identical picks do not manufacture a palette conflict", () => {
  const out = compose({
    picks: [
      { slug: "airy-blue-light", role: "color", detail: "" },
      { slug: "airy-blue-sibling", role: "typography", detail: "" },
    ],
    mode: "full-page",
    intent: "",
  });
  assert.equal(
    out.conflicts.some((c) => c.dimension === "color"),
    false,
    "ΔE between #2563eb and #2f6ae8 is small — no conflict",
  );
});

test("each pick contributes only its assigned role — this is not concatenation", () => {
  const out = compose({
    picks: [
      { slug: "airy-blue-light", role: "typography", detail: "" },
      { slug: "dense-rust-dark", role: "color", detail: "" },
    ],
    mode: "full-page",
    intent: "",
  });

  const typographySection = out.prompt.slice(
    out.prompt.indexOf("Airy Blue → typography"),
    out.prompt.indexOf("Dense Rust → color"),
  );
  // The typography contributor must not smuggle in its own palette.
  assert.equal(typographySection.includes("#2563eb"), false);
  assert.ok(typographySection.includes("minor third"));
  // The colour owner's palette is the one that lands.
  assert.ok(out.prompt.includes("#b8422a"));
  assert.ok(out.prompt.includes("Do not import anything from a source outside its assigned role."));
});

test("anti-patterns are unioned across every pick", () => {
  const out = compose({
    picks: [
      { slug: "airy-blue-light", role: "color", detail: "" },
      { slug: "dense-rust-dark", role: "motion", detail: "" },
    ],
    mode: "full-page",
    intent: "",
  });
  assert.ok(out.prompt.includes("## Do NOT"));
  assert.ok(out.prompt.includes("Do not add a second accent colour"));
});

test("restyle mode changes the instruction, not just the heading", () => {
  const out = compose({
    picks: [{ slug: "airy-blue-light", role: "color", detail: "" }],
    mode: "restyle",
    intent: "",
  });
  assert.ok(out.prompt.includes("Do not change behaviour"));
  assert.ok(out.prompt.includes("Preserve every existing behaviour"));
});

test("intent is carried into the composed prompt", () => {
  const out = compose({
    picks: [{ slug: "airy-blue-light", role: "color", detail: "" }],
    mode: "component",
    intent: "A pricing table with three tiers",
  });
  assert.ok(out.prompt.includes("A pricing table with three tiers"));
});

test("composing an unknown slug fails loudly rather than silently producing half a prompt", () => {
  assert.throws(() =>
    compose({ picks: [{ slug: "does-not-exist", role: "color", detail: "" }], mode: "full-page", intent: "" }),
  );
});

test("composing records a use for every pick", () => {
  const before = getInspiration("airy-blue-light")!.useCount;
  compose({
    picks: [{ slug: "airy-blue-light", role: "color", detail: "" }],
    mode: "full-page",
    intent: "",
  });
  assert.equal(getInspiration("airy-blue-light")!.useCount, before + 1);
});

test("house style reports what a collection agrees on", () => {
  const out = houseStyle("Test", ["airy-blue-light", "airy-blue-sibling"]);
  assert.ok(out.includes("airy"));
  assert.ok(out.includes("restrained"));
  assert.ok(out.includes("## Do NOT"));
});

test("artifacts regenerate from the effective analysis after a human edit", () => {
  setOverride("airy-blue-light", "identity.name", "Renamed By Human");
  const after = getInspiration("airy-blue-light")!;
  assert.equal(after.analysis.identity.name, "Renamed By Human");
  assert.ok(after.artifacts.brief.startsWith("# Renamed By Human"));
  assert.ok(after.artifacts.claudePrompt.includes("Renamed By Human"));
  assert.equal(after.humanVerified, true, "an edit implies verification");
});

test("derived artifacts contain the three distinct shapes", () => {
  const a = analysis({ slug: "x-y", name: "X" });
  const { brief, claudePrompt, tokenSet } = buildArtifacts(a);
  assert.ok(brief.includes("## Anti-patterns"));
  assert.ok(claudePrompt.includes("design SYSTEM, not a page to copy"));
  assert.ok(tokenSet.includes("@theme"));
  assert.ok(tokenSet.includes("--accent:"));
});

test("quality score punishes a thin analysis and rewards a complete one", () => {
  const full = analysis({ slug: "x-y", name: "X" });
  const thin = analysis({ slug: "x-z", name: "Z" });
  thin.philosophy = thin.philosophy.slice(0, 2);
  thin.antiPatterns = thin.antiPatterns.slice(0, 1);
  thin.tags = ["minimal", "airy", "saas"];
  thin.typography.fontCandidates = [];
  thin.implementation.gotchas = [];
  thin.implementation.tailwindTokens = "x";
  thin.color.palette = thin.color.palette.slice(0, 2);
  thin.components = thin.components.slice(0, 1);

  assert.ok(qualityScore(full) > qualityScore(thin));
  assert.ok(qualityScore(full) <= 1 && qualityScore(thin) >= 0);
});
