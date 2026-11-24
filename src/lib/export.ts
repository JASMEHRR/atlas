/**
 * Claude Code integration. Writes a self-contained skill into a target
 * project so `use apple-glass-nav` resolves by reading local files, with no
 * server, no MCP config, and no network.
 */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import {
  allSlugs,
  collectionSlugs,
  createInspiration,
  findByHash,
  getInspiration,
  listCollections,
} from "./repo.ts";
import { houseStyle } from "./compose.ts";
import { IMAGES_DIR } from "./db.ts";
import { Bundle, type Inspiration } from "./schema.ts";
import { rows, run, now } from "./db.ts";

/** Compact table an agent can load first — cheap to read, full of handles. */
export function buildIndex(inspirations: Inspiration[]): string {
  const rowsMd = inspirations
    .map(
      (i) =>
        `| \`${i.slug}\` | ${i.analysis.identity.dna} | ${i.analysis.styleMood.family} | ${i.analysis.layout.density} | ${i.analysis.motion.intensity} | ${i.analysis.components.map((c) => c.kind).slice(0, 4).join(", ")} |`,
    )
    .join("\n");

  return `# Atlas index

${inspirations.length} design references. Each slug resolves to \`inspirations/<slug>.md\`
in this folder. Load this table first; read the individual file only for the
slugs you actually need.

| slug | design DNA | style | density | motion | components |
|---|---|---|---|---|---|
${rowsMd}

## How to use a slug

When asked to build something "using \`<slug>\`", read \`inspirations/<slug>.md\`
and follow its **Claude prompt** section. That section is a complete,
content-agnostic instruction — apply it to whatever is being built.

When given several slugs with roles ("nav from A, motion from B"), each slug
contributes only its assigned role. Do not import a slug's colours if it was
cited for typography. Reconcile conflicts explicitly and state the resolution
rather than blending.
`;
}

function inspirationFile(i: Inspiration): string {
  const frontmatter = [
    `slug: ${i.slug}`,
    `name: ${i.analysis.identity.name}`,
    `dna: ${i.analysis.identity.dna}`,
    `style: ${i.analysis.styleMood.family}`,
    `density: ${i.analysis.layout.density}`,
    `motion: ${i.analysis.motion.intensity}`,
    `difficulty: ${i.analysis.implementation.difficulty}`,
    `quality: ${i.qualityScore}`,
    `human_verified: ${i.humanVerified}`,
    i.provenance.sourceUrl ? `source: ${i.provenance.sourceUrl}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `---
${frontmatter}
---

# ${i.analysis.identity.name} (\`${i.slug}\`)

${i.analysis.identity.whyItWorks}

${i.notes ? `> Personal note: ${i.notes}\n` : ""}
## Claude prompt — use this when asked to build with \`${i.slug}\`

${i.artifacts.claudePrompt}

---

## Token set

\`\`\`css
${i.artifacts.tokenSet}
\`\`\`

---

## Full design brief

${i.artifacts.brief}
`;
}

const SKILL_MD = (count: number) => `---
name: design-library
description: >
  Atlas design reference library. Use whenever a request cites a design
  reference by slug (e.g. "use apple-glass-nav", "the section rhythm from
  linear-hero"), or asks to build UI in a named design language from the
  library. Also use when asked what design references are available.
---

# Design library

This folder holds ${count} structured design references exported from Atlas.
Each is addressable by a stable kebab-case slug.

## Resolving a request

1. Read \`atlas.md\` — a compact table of every slug and its design DNA.
   Always start here; it is small.
2. For each slug the request cites, read \`inspirations/<slug>.md\`.
3. Follow that file's **Claude prompt** section.

## Rules

- These are design *systems*, not pages to copy. Apply the language to the
  content you are actually building. Never reproduce the original's copy,
  brand, imagery, or subject matter.
- When a request assigns roles ("nav from A, motion from B, palette from C"),
  each slug contributes only its assigned role. A slug cited for typography
  contributes no colours.
- When two references disagree — clashing palettes, incompatible density,
  different motion languages — pick a winner and **state the resolution**.
  Never average them, and never silently concatenate both instructions.
- Every reference has an **anti-patterns** section. Honour it: it lists what
  breaks if the language is misapplied.
- \`human_verified: true\` in a file's frontmatter means a human has checked
  and corrected that analysis. Weight it over an unverified one on conflict.
- Font names are inferred from screenshots. Use the given fallback stacks
  unless the user tells you the real face.
`;

export async function exportSkill(targetDir: string): Promise<{
  written: string[];
  root: string;
}> {
  const inspirations = allSlugs()
    .map((s) => getInspiration(s))
    .filter((i): i is Inspiration => i !== null);

  if (inspirations.length === 0) {
    throw new Error("Library is empty — nothing to export.");
  }

  const root = path.join(targetDir, ".claude", "skills", "design-library");
  await mkdir(path.join(root, "inspirations"), { recursive: true });

  const written: string[] = [];
  const write = async (rel: string, body: string) => {
    await writeFile(path.join(root, rel), body, "utf8");
    written.push(path.join(root, rel));
  };

  await write("SKILL.md", SKILL_MD(inspirations.length));
  await write("atlas.md", buildIndex(inspirations));
  for (const i of inspirations) {
    await write(path.join("inspirations", `${i.slug}.md`), inspirationFile(i));
  }

  // Collections export as house-style files — a project usually wants one
  // coherent language, not the whole library.
  const collections = listCollections();
  if (collections.length) {
    await mkdir(path.join(root, "collections"), { recursive: true });
    for (const c of collections) {
      await write(
        path.join("collections", `${slugify(c.name)}.md`),
        houseStyle(c.name, collectionSlugs(c.name)),
      );
    }
  }

  return { written, root };
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "collection";

/* ------------------------------------------------------------------ */
/* Portable bundle — my data, no lock-in                               */
/* ------------------------------------------------------------------ */

export async function exportBundle(): Promise<Bundle> {
  const inspirations = allSlugs()
    .map((s) => getInspiration(s))
    .filter((i): i is Inspiration => i !== null);

  const images: Record<string, string> = {};
  for (const i of inspirations) {
    for (const p of [i.imagePath, i.thumbPath]) {
      const name = path.basename(p);
      if (images[name]) continue;
      try {
        images[name] = (await readFile(path.join(IMAGES_DIR, name))).toString(
          "base64",
        );
      } catch {
        /* a missing file must not block the whole export */
      }
    }
  }

  const recipes = rows<{
    id: string;
    name: string;
    version: number;
    request: string;
    created_at: string;
    updated_at: string;
  }>(`SELECT * FROM recipes`).map((r) => ({
    id: r.id,
    name: r.name,
    version: r.version,
    request: JSON.parse(r.request),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));

  return Bundle.parse({
    atlasVersion: 1,
    exportedAt: now(),
    inspirations,
    recipes,
    images,
  });
}

export async function importBundle(raw: unknown): Promise<{
  imported: number;
  skipped: string[];
}> {
  const bundle = Bundle.parse(raw);
  const existing = new Set(allSlugs());
  const skipped: string[] = [];
  let imported = 0;

  await mkdir(IMAGES_DIR, { recursive: true });
  for (const [name, b64] of Object.entries(bundle.images)) {
    await writeFile(
      path.join(IMAGES_DIR, path.basename(name)),
      Buffer.from(b64, "base64"),
    );
  }

  for (const i of bundle.inspirations) {
    // Skip on either handle: an image already held under a different slug
    // would otherwise hit the sha256 constraint and abort the whole import.
    if (existing.has(i.slug) || findByHash(i.sha256)) {
      skipped.push(i.slug);
      continue;
    }
    // Import writes the record directly: the analysis is already validated
    // and re-running the pipeline would burn tokens re-deriving known output.
    createInspiration({
      analysis: i.analysis,
      provenance: i.provenance,
      imagePath: i.imagePath,
      thumbPath: i.thumbPath,
      sha256: i.sha256,
      width: i.width,
      height: i.height,
      model: "imported",
    });
    if (i.notes) {
      run(`UPDATE inspirations SET notes = ? WHERE slug = ?`, i.notes, i.slug);
    }
    if (i.humanVerified) {
      run(`UPDATE inspirations SET human_verified = 1 WHERE slug = ?`, i.slug);
    }
    imported++;
  }

  for (const r of bundle.recipes) {
    run(
      `INSERT OR IGNORE INTO recipes (id, name, version, request, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      r.id,
      r.name,
      r.version,
      JSON.stringify(r.request),
      r.createdAt,
      r.updatedAt,
    );
  }

  return { imported, skipped };
}
