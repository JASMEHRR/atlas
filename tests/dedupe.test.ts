import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Point the DB at a throwaway directory before anything imports db.ts.
const dir = mkdtempSync(path.join(tmpdir(), "atlas-test-"));
process.env.ATLAS_DATA_DIR = dir;

const { createInspiration, findByHash, allSlugs } = await import(
  "../src/lib/repo.ts"
);
const { closeDb } = await import("../src/lib/db.ts");
const { analysis } = await import("./fixtures.ts");

const provenance = {
  sourceUrl: null,
  capturedAt: "2026-01-01T00:00:00.000Z",
  captureKind: "unknown" as const,
  originalFilename: null,
};

const hash = "a".repeat(64);

const create = (slug: string) =>
  createInspiration({
    analysis: analysis({
      slug,
      name: slug,
      family: "minimal",
      density: "airy",
      motion: "restrained",
      accent: "#2563eb",
      tags: ["minimal"],
    }),
    provenance,
    imagePath: `/api/images/${slug}.png`,
    thumbPath: `/api/images/${slug}.thumb.webp`,
    sha256: hash,
    width: 1440,
    height: 900,
    model: "test",
  });

before(() => create("first-capture"));
after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

// Two jobs can pass the ingest-stage hash check before either reaches index;
// the second must report a duplicate rather than a raw SQL constraint error.
test("a second slug carrying the same image is rejected by name", () => {
  assert.throws(() => create("second-capture"), /first-capture/);
});

test("the rejected insert leaves nothing behind", () => {
  assert.equal(findByHash(hash), "first-capture");
  assert.deepEqual(allSlugs(), ["first-capture"]);
});
