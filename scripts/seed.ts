/**
 * Seed the library by running the REAL pipeline over real screenshots.
 *
 *   npm run seed -- ./path/one.png ./path/two.png
 *
 * With no arguments it looks for images in ./seed-screenshots/. This is the
 * same code path the web app uses — same stages, same validation, same
 * failures — so a green run here means ingestion genuinely works.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

// Next loads .env itself; a standalone script has to ask.
try {
  process.loadEnvFile(path.resolve(".env"));
} catch {
  /* no .env — the checks below report it properly */
}

import { createJob, getJob, runJob } from "../src/lib/jobs.ts";
import { getInspiration } from "../src/lib/repo.ts";

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

async function inputs(): Promise<string[]> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  if (args.length) return args.map((a) => path.resolve(a));

  const dir = path.resolve("seed-screenshots");
  try {
    const names = await readdir(dir);
    return names.filter((n) => IMAGE_EXT.test(n)).map((n) => path.join(dir, n));
  } catch {
    return [];
  }
}

const files = await inputs();

if (files.length === 0) {
  console.error(
    "No screenshots given.\n\n" +
      "  npm run seed -- ./shot-one.png ./shot-two.png\n" +
      "  (or drop images into ./seed-screenshots/ and re-run)\n",
  );
  process.exit(1);
}

const { isConfigured } = await import("../src/lib/ai/index.ts");
if (!isConfigured()) {
  console.error(
    "No AI provider is configured.\n\n" +
      "The ingest stage (hashing, thumbnails, palette extraction) runs without one,\n" +
      "but the vision stage cannot. Add at least one key to .env:\n" +
      "  GROQ_API_KEY        (recommended — fastest)\n" +
      "  OPENROUTER_API_KEY  (free models only)\n" +
      "  GEMINI_API_KEY      (free tier only)\n",
  );
}

console.log(`Seeding ${files.length} screenshot(s) through the real pipeline.\n`);

let ok = 0;
for (const file of files) {
  const name = path.basename(file);
  process.stdout.write(`${name} … `);

  const id = createJob({
    label: name,
    kind: "image",
    source: (await readFile(file)).toString("base64"),
    filename: name,
  });

  await runJob(id);
  const job = getJob(id)!;
  const failed = job.stages.find((s) => s.status === "failed");

  if (failed) {
    console.log(`FAILED at ${failed.stage}`);
    console.log(`   ${failed.error}\n`);
    continue;
  }

  const inspiration = job.slug ? getInspiration(job.slug) : null;
  if (!inspiration) {
    console.log("indexed but not readable back — check the database\n");
    continue;
  }

  ok++;
  console.log(`ok → ${inspiration.slug}`);
  console.log(`   ${inspiration.analysis.identity.dna}`);
  console.log(
    `   ${inspiration.analysis.color.palette
      .slice(0, 5)
      .map((p) => p.hex)
      .join(" ")}  quality ${inspiration.qualityScore}\n`,
  );
}

console.log(`Done. ${ok}/${files.length} indexed.`);
if (ok > 0) console.log("Run `npm run dev` and open http://localhost:3000");
