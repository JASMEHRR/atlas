/**
 * Reading and writing inspirations. The important rule lives here: the raw
 * model analysis is stored immutably per version, human overrides are stored
 * separately, and every read applies overrides last — so a human edit
 * outranks AI text forever, including across re-analysis.
 */
import { row, rows, run, tx, now } from "./db.ts";
import { buildArtifacts, qualityScore } from "./derive.ts";
import { hexToLab } from "./color.ts";
import { normaliseTags } from "./vocab.ts";
import {
  Analysis,
  Artifacts,
  Inspiration,
  Provenance,
  type OverridableField,
} from "./schema.ts";

type InspirationRow = {
  slug: string;
  sha256: string;
  image_path: string;
  thumb_path: string;
  width: number;
  height: number;
  provenance: string;
  artifacts: string;
  quality_score: number;
  human_verified: number;
  use_count: number;
  analysis_version: number;
  notes: string;
  created_at: string;
  updated_at: string;
};

/** Apply stored overrides onto an analysis. Pure — used on every read. */
export function applyOverrides(
  analysis: Analysis,
  overrides: Array<{ field: string; value: string }>,
): Analysis {
  const out = structuredClone(analysis) as Record<string, any>;
  for (const { field, value } of overrides) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      continue;
    }
    const path = field.split(".");
    let target = out;
    for (const key of path.slice(0, -1)) {
      if (typeof target[key] !== "object" || target[key] === null) break;
      target = target[key];
    }
    target[path[path.length - 1]!] = parsed;
  }
  // Re-validate: a bad override must not corrupt the record silently.
  const check = Analysis.safeParse(out);
  return check.success ? check.data : analysis;
}

export function effectiveAnalysis(slug: string): Analysis | null {
  const stored = row<{ payload: string }>(
    `SELECT a.payload FROM analyses a
      JOIN inspirations i ON i.slug = a.slug AND i.analysis_version = a.version
      WHERE a.slug = ?`,
    slug,
  );
  if (!stored) return null;
  const parsed = Analysis.safeParse(JSON.parse(stored.payload));
  if (!parsed.success) return null;

  const overrides = rows<{ field: string; value: string }>(
    `SELECT field, value FROM field_overrides WHERE slug = ?`,
    slug,
  );
  return applyOverrides(parsed.data, overrides);
}

export function getInspiration(slug: string): Inspiration | null {
  const r = row<InspirationRow>(`SELECT * FROM inspirations WHERE slug = ?`, slug);
  if (!r) return null;
  const analysis = effectiveAnalysis(slug);
  if (!analysis) return null;

  const collections = rows<{ name: string }>(
    `SELECT name FROM collection_members WHERE slug = ? ORDER BY name`,
    slug,
  ).map((c) => c.name);

  return Inspiration.parse({
    slug: r.slug,
    analysis,
    artifacts: Artifacts.parse(JSON.parse(r.artifacts)),
    provenance: Provenance.parse(JSON.parse(r.provenance)),
    imagePath: r.image_path,
    thumbPath: r.thumb_path,
    sha256: r.sha256,
    width: r.width,
    height: r.height,
    qualityScore: r.quality_score,
    humanVerified: r.human_verified === 1,
    useCount: r.use_count,
    analysisVersion: r.analysis_version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    notes: r.notes,
    collections,
  });
}

export const allSlugs = (): string[] =>
  rows<{ slug: string }>(`SELECT slug FROM inspirations ORDER BY created_at`).map(
    (r) => r.slug,
  );

export const findByHash = (sha: string): string | null =>
  row<{ slug: string }>(`SELECT slug FROM inspirations WHERE sha256 = ?`, sha)
    ?.slug ?? null;

/** Rebuild every derived row (facets, tags, palette, components, FTS). */
function reindex(slug: string, analysis: Analysis): void {
  run(`DELETE FROM facets WHERE slug = ?`, slug);
  run(`DELETE FROM tags WHERE slug = ?`, slug);
  run(`DELETE FROM palette WHERE slug = ?`, slug);
  run(`DELETE FROM components WHERE slug = ?`, slug);
  run(`DELETE FROM inspiration_fts WHERE slug = ?`, slug);

  run(
    `INSERT INTO facets (slug, family, density, motion, difficulty)
     VALUES (?, ?, ?, ?, ?)`,
    slug,
    analysis.styleMood.family,
    analysis.layout.density,
    analysis.motion.intensity,
    analysis.implementation.difficulty,
  );

  const tags = normaliseTags(analysis.tags);
  for (const t of tags) {
    run(
      `INSERT OR IGNORE INTO tags (slug, tag, kind) VALUES (?, ?, 'tag')`,
      slug,
      t,
    );
  }
  for (const m of normaliseTags(analysis.styleMood.moods)) {
    run(`INSERT OR IGNORE INTO tags (slug, tag, kind) VALUES (?, ?, 'mood')`, slug, m);
  }
  for (const t of normaliseTags(analysis.surface.treatments)) {
    run(
      `INSERT OR IGNORE INTO tags (slug, tag, kind) VALUES (?, ?, 'treatment')`,
      slug,
      t,
    );
  }

  for (const s of analysis.color.palette) {
    const lab = hexToLab(s.hex);
    run(
      `INSERT OR REPLACE INTO palette (slug, hex, role, weight, l, a, b)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      slug,
      s.hex.toLowerCase(),
      s.role,
      s.weight,
      lab.l,
      lab.a,
      lab.b,
    );
  }

  for (const c of analysis.components) {
    run(
      `INSERT OR IGNORE INTO components (slug, kind, label) VALUES (?, ?, ?)`,
      slug,
      c.kind,
      c.label,
    );
  }

  run(
    `INSERT INTO inspiration_fts (slug, name, dna, why, tags, prose)
     VALUES (?, ?, ?, ?, ?, ?)`,
    slug,
    analysis.identity.name,
    analysis.identity.dna,
    analysis.identity.whyItWorks,
    [
      ...tags,
      ...normaliseTags(analysis.styleMood.moods),
      analysis.styleMood.family,
      analysis.layout.density,
      analysis.motion.intensity,
      ...analysis.components.map((c) => `${c.kind} ${c.label}`),
    ].join(" "),
    [
      analysis.searchText,
      analysis.styleMood.brandPersonality,
      analysis.typography.pairingIntent,
      analysis.color.paletteRationale,
      analysis.layout.sectionPacing,
      analysis.ux.hierarchyStrategy,
      ...analysis.philosophy,
    ].join("\n"),
  );
}

export type CreateInput = {
  analysis: Analysis;
  provenance: Provenance;
  imagePath: string;
  thumbPath: string;
  sha256: string;
  width: number;
  height: number;
  model: string;
};

export function createInspiration(input: CreateInput): string {
  const slug = input.analysis.identity.slug;
  const ts = now();
  tx(() => {
    run(
      `INSERT INTO inspirations
        (slug, sha256, image_path, thumb_path, width, height, provenance,
         artifacts, quality_score, human_verified, use_count, analysis_version,
         notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 1, '', ?, ?)`,
      slug,
      input.sha256,
      input.imagePath,
      input.thumbPath,
      input.width,
      input.height,
      JSON.stringify(input.provenance),
      JSON.stringify(buildArtifacts(input.analysis)),
      qualityScore(input.analysis),
      ts,
      ts,
    );
    run(
      `INSERT INTO analyses (slug, version, payload, model, created_at)
       VALUES (?, 1, ?, ?, ?)`,
      slug,
      JSON.stringify(input.analysis),
      input.model,
      ts,
    );
    reindex(slug, input.analysis);
  });
  return slug;
}

/** Re-analysis: new immutable version, overrides survive untouched. */
export function addAnalysisVersion(
  slug: string,
  analysis: Analysis,
  model: string,
): void {
  // Keep the original slug — it is the stable public handle.
  const pinned: Analysis = {
    ...analysis,
    identity: { ...analysis.identity, slug },
  };
  const next =
    (row<{ v: number }>(
      `SELECT COALESCE(MAX(version), 0) AS v FROM analyses WHERE slug = ?`,
      slug,
    )?.v ?? 0) + 1;

  tx(() => {
    run(
      `INSERT INTO analyses (slug, version, payload, model, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      slug,
      next,
      JSON.stringify(pinned),
      model,
      now(),
    );
    run(
      `UPDATE inspirations SET analysis_version = ?, updated_at = ? WHERE slug = ?`,
      next,
      now(),
      slug,
    );
    refreshDerived(slug);
  });
}

/** Recompute artifacts, quality and indexes from the effective analysis. */
export function refreshDerived(slug: string): void {
  const analysis = effectiveAnalysis(slug);
  if (!analysis) return;
  run(
    `UPDATE inspirations SET artifacts = ?, quality_score = ?, updated_at = ?
      WHERE slug = ?`,
    JSON.stringify(buildArtifacts(analysis)),
    qualityScore(analysis),
    now(),
    slug,
  );
  reindex(slug, analysis);
}

/** A human edit. Sticky, and marks the entry verified. */
export function setOverride(
  slug: string,
  field: OverridableField,
  value: unknown,
): void {
  tx(() => {
    run(
      `INSERT OR REPLACE INTO field_overrides (slug, field, value, created_at)
       VALUES (?, ?, ?, ?)`,
      slug,
      field,
      JSON.stringify(value),
      now(),
    );
    run(`UPDATE inspirations SET human_verified = 1 WHERE slug = ?`, slug);
    refreshDerived(slug);
  });
}

export const overriddenFields = (slug: string): string[] =>
  rows<{ field: string }>(
    `SELECT field FROM field_overrides WHERE slug = ?`,
    slug,
  ).map((r) => r.field);

export function clearOverride(slug: string, field: string): void {
  run(`DELETE FROM field_overrides WHERE slug = ? AND field = ?`, slug, field);
  refreshDerived(slug);
}

export const setNotes = (slug: string, notes: string): void =>
  run(
    `UPDATE inspirations SET notes = ?, updated_at = ? WHERE slug = ?`,
    notes,
    now(),
    slug,
  );

export const setVerified = (slug: string, verified: boolean): void =>
  run(
    `UPDATE inspirations SET human_verified = ?, updated_at = ? WHERE slug = ?`,
    verified ? 1 : 0,
    now(),
    slug,
  );

/** Called whenever a slug is actually referenced — drives "most used". */
export const recordUse = (slug: string): void =>
  run(`UPDATE inspirations SET use_count = use_count + 1 WHERE slug = ?`, slug);

export function deleteInspiration(slug: string): void {
  tx(() => {
    run(`DELETE FROM inspiration_fts WHERE slug = ?`, slug);
    run(`DELETE FROM inspirations WHERE slug = ?`, slug);
  });
}

/* ---- collections ------------------------------------------------- */

export function addToCollection(name: string, slug: string): void {
  tx(() => {
    run(
      `INSERT OR IGNORE INTO collections (name, created_at) VALUES (?, ?)`,
      name,
      now(),
    );
    run(
      `INSERT OR IGNORE INTO collection_members (name, slug) VALUES (?, ?)`,
      name,
      slug,
    );
  });
}

export const removeFromCollection = (name: string, slug: string): void =>
  run(`DELETE FROM collection_members WHERE name = ? AND slug = ?`, name, slug);

export const listCollections = (): Array<{ name: string; count: number }> =>
  rows<{ name: string; count: number }>(
    `SELECT c.name, COUNT(m.slug) AS count
       FROM collections c LEFT JOIN collection_members m ON m.name = c.name
      GROUP BY c.name ORDER BY c.name`,
  );

export const collectionSlugs = (name: string): string[] =>
  rows<{ slug: string }>(
    `SELECT slug FROM collection_members WHERE name = ? ORDER BY slug`,
    name,
  ).map((r) => r.slug);
