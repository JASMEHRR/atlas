/**
 * Hybrid search. Three signals, combined:
 *   1. FTS5/BM25 over model-authored prose (the "semantic-ish" layer)
 *   2. exact/prefix lexical matches on name, slug, tags, components
 *   3. facet filters, including perceptual colour distance
 *
 * There is no embedding model here. None of the three configured providers
 * exposes a free embeddings endpoint we can rely on, and bundling a local one
 * would mean a ~100MB download inside a "zero-config" promise. The substitute
 * is a model-authored searchText blob (rich retrieval vocabulary) written at
 * ingest time, plus optional query expansion at search time — both of which
 * ride the same provider abstraction and cost nothing extra.
 * Documented as a real tradeoff in the README.
 */
import { rows } from "./db.ts";
import { deltaE, hexToLab } from "./color.ts";
import { normaliseTag } from "./vocab.ts";
import { expandQuery } from "./analyze.ts";
import {
  SearchHit,
  type Facets,
  type SearchQuery,
  type Swatch,
} from "./schema.ts";
import { effectiveAnalysis } from "./repo.ts";

/** FTS5 MATCH is a query language; user text must be quoted term-by-term. */
function ftsQuery(terms: string[]): string {
  const cleaned = terms
    .flatMap((t) => t.split(/\s+/))
    .map((t) => t.replace(/["'*()]/g, "").trim())
    .filter((t) => t.length > 1);
  if (cleaned.length === 0) return "";
  // Prefix-match each term and OR them: recall first, ranking sorts it out.
  return [...new Set(cleaned)].map((t) => `"${t}"*`).join(" OR ");
}

type Candidate = {
  slug: string;
  score: number;
  matchedOn: Set<string>;
};

function facetFiltered(f: Facets): Set<string> | null {
  const clauses: string[] = [];
  const params: string[] = [];

  if (f.family.length) {
    clauses.push(`fa.family IN (${f.family.map(() => "?").join(",")})`);
    params.push(...f.family);
  }
  if (f.density.length) {
    clauses.push(`fa.density IN (${f.density.map(() => "?").join(",")})`);
    params.push(...f.density);
  }
  if (f.motion.length) {
    clauses.push(`fa.motion IN (${f.motion.map(() => "?").join(",")})`);
    params.push(...f.motion);
  }
  if (f.difficulty.length) {
    clauses.push(`fa.difficulty IN (${f.difficulty.map(() => "?").join(",")})`);
    params.push(...f.difficulty);
  }
  if (f.verifiedOnly) clauses.push(`i.human_verified = 1`);
  if (f.collection) {
    clauses.push(
      `EXISTS (SELECT 1 FROM collection_members cm
                WHERE cm.slug = i.slug AND cm.name = ?)`,
    );
    params.push(f.collection);
  }
  for (const kind of f.components) {
    clauses.push(
      `EXISTS (SELECT 1 FROM components c WHERE c.slug = i.slug AND c.kind = ?)`,
    );
    params.push(kind);
  }
  for (const mood of f.moods) {
    const n = normaliseTag(mood);
    if (!n) continue;
    clauses.push(`EXISTS (SELECT 1 FROM tags t WHERE t.slug = i.slug AND t.tag = ?)`);
    params.push(n);
  }

  if (clauses.length === 0 && !f.color) return null;

  const sql = `SELECT i.slug FROM inspirations i
                 JOIN facets fa ON fa.slug = i.slug
                ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}`;
  let allowed = new Set(rows<{ slug: string }>(sql, ...params).map((r) => r.slug));

  if (f.color) {
    // Perceptual match, not string match: a swatch picker should find
    // "close enough" colours. ΔE 25 is roughly "same colour family".
    const target = hexToLab(f.color);
    const near = new Set<string>();
    for (const p of rows<{ slug: string; l: number; a: number; b: number }>(
      `SELECT slug, l, a, b FROM palette`,
    )) {
      if (deltaE(target, { l: p.l, a: p.a, b: p.b }) <= 25) near.add(p.slug);
    }
    allowed = new Set([...allowed].filter((s) => near.has(s)));
  }
  return allowed;
}

export async function search(query: SearchQuery): Promise<SearchHit[]> {
  const q = query.q.trim();
  const allowed = facetFiltered(query.facets);
  const candidates = new Map<string, Candidate>();

  const bump = (slug: string, points: number, why: string) => {
    if (allowed && !allowed.has(slug)) return;
    const c = candidates.get(slug) ?? { slug, score: 0, matchedOn: new Set() };
    c.score += points;
    c.matchedOn.add(why);
    candidates.set(slug, c);
  };

  if (q) {
    const terms = [q];
    let expandedTerms: string[] = [];
    if (query.expand) {
      const ex = await expandQuery(q);
      expandedTerms = [...ex.keywords, ...ex.moods];
      // Expansion-derived facets are ranking hints, never hard filters —
      // a wrong guess must not empty the result set.
      for (const fam of ex.families) {
        for (const r of rows<{ slug: string }>(
          `SELECT slug FROM facets WHERE family = ?`,
          fam,
        )) {
          bump(r.slug, 3, `style: ${fam}`);
        }
      }
      for (const d of ex.density) {
        for (const r of rows<{ slug: string }>(
          `SELECT slug FROM facets WHERE density = ?`,
          d,
        )) {
          bump(r.slug, 2, `${d} density`);
        }
      }
      for (const m of ex.motion) {
        for (const r of rows<{ slug: string }>(
          `SELECT slug FROM facets WHERE motion = ?`,
          m,
        )) {
          bump(r.slug, 2, `${m} motion`);
        }
      }
    }

    const match = ftsQuery([...terms, ...expandedTerms]);
    if (match) {
      // bm25() is negative-better; flip and normalise into a 0..12 band so it
      // composes with the hand-tuned lexical points below.
      const hits = rows<{ slug: string; rank: number }>(
        `SELECT slug, bm25(inspiration_fts, 8.0, 6.0, 4.0, 5.0, 1.0) AS rank
           FROM inspiration_fts WHERE inspiration_fts MATCH ?
          ORDER BY rank LIMIT 300`,
        match,
      );
      const best = hits.length ? Math.abs(hits[0]!.rank) || 1 : 1;
      for (const h of hits) {
        bump(h.slug, (Math.abs(h.rank) / best) * 12, "text");
      }
    }

    // Lexical: strong, cheap signals FTS ranking alone underweights.
    const like = `%${q.toLowerCase()}%`;
    for (const r of rows<{ slug: string }>(
      `SELECT slug FROM inspirations WHERE lower(slug) LIKE ?`,
      like,
    )) {
      bump(r.slug, r.slug.toLowerCase() === q.toLowerCase() ? 40 : 14, "slug");
    }
    for (const r of rows<{ slug: string; name: string }>(
      `SELECT slug, name FROM inspiration_fts WHERE lower(name) LIKE ?`,
      like,
    )) {
      bump(r.slug, r.name.toLowerCase() === q.toLowerCase() ? 30 : 10, "name");
    }
    const tagTerms = new Set(
      [q, ...q.split(/\s+/)].map(normaliseTag).filter(Boolean) as string[],
    );
    for (const t of tagTerms) {
      for (const r of rows<{ slug: string; kind: string }>(
        `SELECT slug, kind FROM tags WHERE tag = ?`,
        t,
      )) {
        bump(r.slug, 8, `${r.kind}: ${t}`);
      }
    }
    for (const r of rows<{ slug: string; kind: string }>(
      `SELECT slug, kind FROM components WHERE lower(kind) LIKE ? OR lower(label) LIKE ?`,
      like,
      like,
    )) {
      bump(r.slug, 6, `has ${r.kind}`);
    }
  } else {
    // No query: browse mode. Everything that survives the facets, newest first.
    for (const r of rows<{ slug: string }>(
      `SELECT slug FROM inspirations ORDER BY created_at DESC`,
    )) {
      bump(r.slug, 1, "all");
    }
  }

  const ranked = [...candidates.values()]
    .map((c) => {
      const meta = hitMeta(c.slug);
      if (!meta) return null;
      // Quality and verification are tie-breakers, not primary rank: a
      // perfect keyword match on an unverified entry still wins.
      const score =
        c.score + meta.qualityScore * 2 + (meta.humanVerified ? 1.5 : 0);
      return { ...meta, score, matchedOn: [...c.matchedOn].slice(0, 4) };
    })
    .filter((x): x is SearchHit => x !== null)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, query.limit);

  return ranked.map((r) => SearchHit.parse(r));
}

type HitMeta = Omit<SearchHit, "score" | "matchedOn">;

function hitMeta(slug: string): HitMeta | null {
  const analysis = effectiveAnalysis(slug);
  if (!analysis) return null;
  const r = rows<{
    thumb_path: string;
    quality_score: number;
    human_verified: number;
  }>(
    `SELECT thumb_path, quality_score, human_verified FROM inspirations WHERE slug = ?`,
    slug,
  )[0];
  if (!r) return null;

  return {
    slug,
    name: analysis.identity.name,
    dna: analysis.identity.dna,
    whyItWorks: analysis.identity.whyItWorks,
    thumbPath: r.thumb_path,
    family: analysis.styleMood.family,
    tags: analysis.tags,
    palette: analysis.color.palette,
    qualityScore: r.quality_score,
    humanVerified: r.human_verified === 1,
  };
}

/**
 * Similar inspirations — the embedding-neighbour substitute. Tag Jaccard
 * carries most of the signal; palette distance and shared facets refine it.
 */
export function similar(slug: string, limit = 6): SearchHit[] {
  const base = effectiveAnalysis(slug);
  if (!base) return [];

  const baseTags = new Set([
    ...base.tags.map(normaliseTag).filter(Boolean),
    ...base.styleMood.moods.map(normaliseTag).filter(Boolean),
  ] as string[]);
  const baseAccent = base.color.palette.find((p) => p.role === "accent");
  const baseGround = base.color.palette.find((p) => p.role === "ground");

  const scored: Array<{ slug: string; score: number; matchedOn: string[] }> = [];

  for (const other of rows<{ slug: string }>(
    `SELECT slug FROM inspirations WHERE slug != ?`,
    slug,
  )) {
    const a = effectiveAnalysis(other.slug);
    if (!a) continue;

    const otherTags = new Set([
      ...a.tags.map(normaliseTag).filter(Boolean),
      ...a.styleMood.moods.map(normaliseTag).filter(Boolean),
    ] as string[]);
    const shared = [...baseTags].filter((t) => otherTags.has(t));
    const union = new Set([...baseTags, ...otherTags]).size || 1;
    const jaccard = shared.length / union;

    let score = jaccard * 10;
    const why: string[] = [];
    if (shared.length) why.push(shared.slice(0, 3).join(", "));

    if (a.styleMood.family === base.styleMood.family) {
      score += 3;
      why.push(a.styleMood.family);
    }
    if (a.layout.density === base.layout.density) score += 1;
    if (a.motion.intensity === base.motion.intensity) score += 1;

    const pair = (x?: Swatch, y?: Swatch) =>
      x && y ? Math.max(0, 1 - deltaE(hexToLab(x.hex), hexToLab(y.hex)) / 60) : 0;
    const colourAffinity =
      pair(baseAccent, a.color.palette.find((p) => p.role === "accent")) +
      pair(baseGround, a.color.palette.find((p) => p.role === "ground"));
    if (colourAffinity > 1.2) why.push("close palette");
    score += colourAffinity * 2;

    scored.push({ slug: other.slug, score, matchedOn: why.slice(0, 3) });
  }

  return scored
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map((s) => {
      const meta = hitMeta(s.slug);
      return meta
        ? SearchHit.parse({ ...meta, score: s.score, matchedOn: s.matchedOn })
        : null;
    })
    .filter((x): x is SearchHit => x !== null);
}

/** Facet counts for the filter rail. Cheap enough to compute per request. */
export function facetCounts() {
  return {
    family: rows<{ value: string; count: number }>(
      `SELECT family AS value, COUNT(*) AS count FROM facets GROUP BY family ORDER BY count DESC`,
    ),
    density: rows<{ value: string; count: number }>(
      `SELECT density AS value, COUNT(*) AS count FROM facets GROUP BY density ORDER BY count DESC`,
    ),
    motion: rows<{ value: string; count: number }>(
      `SELECT motion AS value, COUNT(*) AS count FROM facets GROUP BY motion ORDER BY count DESC`,
    ),
    difficulty: rows<{ value: string; count: number }>(
      `SELECT difficulty AS value, COUNT(*) AS count FROM facets GROUP BY difficulty ORDER BY count DESC`,
    ),
    components: rows<{ value: string; count: number }>(
      `SELECT kind AS value, COUNT(DISTINCT slug) AS count FROM components
        GROUP BY kind ORDER BY count DESC`,
    ),
    tags: rows<{ value: string; count: number }>(
      `SELECT tag AS value, COUNT(*) AS count FROM tags
        GROUP BY tag ORDER BY count DESC, tag LIMIT 40`,
    ),
    colors: rows<{ value: string; count: number }>(
      `SELECT hex AS value, COUNT(*) AS count FROM palette
        WHERE role IN ('accent','ground','ink')
        GROUP BY hex ORDER BY count DESC LIMIT 24`,
    ),
  };
}

/**
 * Gap analysis — what the library is missing. Blunt on purpose: a skew
 * warning is only useful if it names the thing to go collect.
 */
export function gapAnalysis(): Array<{ gap: string; detail: string }> {
  const total =
    rows<{ n: number }>(`SELECT COUNT(*) AS n FROM inspirations`)[0]?.n ?? 0;
  if (total < 4) {
    return [
      {
        gap: "Library is small",
        detail: `${total} entries. Patterns in your taste only become visible around 10-15.`,
      },
    ];
  }

  const out: Array<{ gap: string; detail: string }> = [];
  const share = (r: Array<{ value: string; count: number }>) =>
    r.map((x) => ({ ...x, pct: x.count / total }));

  const counts = facetCounts();
  for (const [label, list] of [
    ["style", counts.family],
    ["density", counts.density],
    ["motion language", counts.motion],
  ] as const) {
    const top = share(list)[0];
    if (top && top.pct >= 0.6) {
      const missing = list.filter((x) => x.count === 0).map((x) => x.value);
      out.push({
        gap: `${Math.round(top.pct * 100)}% of your library is "${top.value}" ${label}`,
        detail: missing.length
          ? `You have nothing in: ${missing.join(", ")}.`
          : `Consider collecting contrast to "${top.value}".`,
      });
    }
  }

  const commonComponents = ["navbar", "hero", "pricing-table", "form", "table"];
  const present = new Set(counts.components.map((c) => c.value));
  const absent = commonComponents.filter((c) => !present.has(c));
  if (absent.length) {
    out.push({
      gap: "Missing common component references",
      detail: `Nothing in your library demonstrates: ${absent.join(", ")}.`,
    });
  }

  const weak = rows<{ n: number }>(
    `SELECT COUNT(*) AS n FROM inspirations WHERE quality_score < 0.6 AND human_verified = 0`,
  )[0]?.n;
  if (weak && weak > 0) {
    out.push({
      gap: `${weak} ${weak === 1 ? "entry has" : "entries have"} a weak analysis`,
      detail: "Low confidence or thin coverage, and not yet human-verified.",
    });
  }

  const dark = rows<{ n: number }>(
    `SELECT COUNT(DISTINCT slug) AS n FROM palette WHERE role = 'ground' AND l < 40`,
  )[0]?.n ?? 0;
  if (dark / total < 0.15) {
    out.push({
      gap: "Almost no dark-ground references",
      detail: `${dark} of ${total} entries use a dark ground. Dark UI is hard to derive from light references.`,
    });
  }

  return out;
}
