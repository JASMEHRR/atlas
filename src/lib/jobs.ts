/**
 * Staged ingestion pipeline. Every stage is a persisted row, so a failure is
 * visible with its error text and retryable from where it stopped rather than
 * from the beginning. Progress is polled/streamed from the same rows, which is
 * why there is never a dead spinner: the UI always knows which stage is live.
 */
import { randomUUID } from "node:crypto";
import { row, rows, run, now } from "./db.ts";
import { STAGES, Job, type Stage, type Provenance } from "./schema.ts";
import { storeImage, screenshotUrl, sha256 } from "./images.ts";
import { analyzeScreenshot } from "./analyze.ts";
import {
  createInspiration,
  allSlugs,
  findByHash,
  duplicateImageMessage,
} from "./repo.ts";
import { buildArtifacts } from "./derive.ts";

/** Staged input, persisted so a retry doesn't need the original upload. */
type Payload = {
  kind: "image" | "url";
  /** base64 for image ingest; the URL for url ingest. */
  source: string;
  filename: string | null;
  sourceUrl: string | null;
  hint?: string;
  /** Filled by the ingest stage so later stages can resume without it. */
  stored?: {
    sha256: string;
    imagePath: string;
    thumbPath: string;
    width: number;
    height: number;
    palette: unknown;
    visionBase64: string;
  };
  analysis?: unknown;
  /** Which provider/model actually produced the analysis. */
  modelLabel?: string;
};

const readPayload = (id: string): Payload =>
  JSON.parse(
    row<{ payload: string }>(`SELECT payload FROM jobs WHERE id = ?`, id)!.payload,
  );

const writePayload = (id: string, p: Payload): void =>
  run(`UPDATE jobs SET payload = ? WHERE id = ?`, JSON.stringify(p), id);

export function createJob(input: {
  label: string;
  kind: "image" | "url";
  source: string;
  filename?: string | null;
  sourceUrl?: string | null;
  hint?: string;
}): string {
  const id = randomUUID();
  const payload: Payload = {
    kind: input.kind,
    source: input.source,
    filename: input.filename ?? null,
    sourceUrl: input.sourceUrl ?? null,
    hint: input.hint,
  };
  run(
    `INSERT INTO jobs (id, label, slug, status, payload, created_at)
     VALUES (?, ?, NULL, 'running', ?, ?)`,
    id,
    input.label,
    JSON.stringify(payload),
    now(),
  );
  for (const stage of STAGES) {
    run(
      `INSERT INTO job_stages (job_id, stage, status, error, started_at, finished_at)
       VALUES (?, ?, 'pending', NULL, NULL, NULL)`,
      id,
      stage,
    );
  }
  return id;
}

const mark = (
  id: string,
  stage: Stage,
  status: string,
  error: string | null = null,
): void =>
  run(
    `UPDATE job_stages
        SET status = ?, error = ?,
            started_at = COALESCE(started_at, CASE WHEN ? = 'running' THEN ? END),
            finished_at = CASE WHEN ? IN ('done','failed') THEN ? ELSE finished_at END
      WHERE job_id = ? AND stage = ?`,
    status,
    error,
    status,
    now(),
    status,
    now(),
    id,
    stage,
  );

export function getJob(id: string): Job | null {
  const j = row<{
    id: string;
    label: string;
    slug: string | null;
    status: string;
    created_at: string;
  }>(`SELECT id, label, slug, status, created_at FROM jobs WHERE id = ?`, id);
  if (!j) return null;

  const stages = rows<{
    stage: string;
    status: string;
    error: string | null;
    started_at: string | null;
    finished_at: string | null;
  }>(`SELECT * FROM job_stages WHERE job_id = ?`, id);

  return Job.parse({
    id: j.id,
    label: j.label,
    slug: j.slug,
    status: j.status,
    createdAt: j.created_at,
    // Order by the pipeline, not by whatever SQLite returns.
    stages: STAGES.map((s) => {
      const found = stages.find((r) => r.stage === s)!;
      return {
        stage: s,
        status: found.status,
        error: found.error,
        startedAt: found.started_at,
        finishedAt: found.finished_at,
      };
    }),
  });
}

export const listJobs = (limit = 30): Job[] =>
  rows<{ id: string }>(
    `SELECT id FROM jobs ORDER BY created_at DESC LIMIT ?`,
    limit,
  )
    .map((r) => getJob(r.id))
    .filter((j): j is Job => j !== null);

export const activeJobs = (): Job[] =>
  listJobs(50).filter((j) => j.status === "running");

/* ------------------------------------------------------------------ */
/* Stage implementations                                               */
/* ------------------------------------------------------------------ */

async function runIngest(id: string, p: Payload): Promise<Payload> {
  const buf =
    p.kind === "url"
      ? await screenshotUrl(p.source)
      : Buffer.from(p.source, "base64");

  const existing = findByHash(sha256(buf));
  if (existing) throw new Error(duplicateImageMessage(existing));

  const hint =
    (p.filename ?? p.sourceUrl ?? "capture")
      .replace(/^https?:\/\//, "")
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 24) || "capture";

  const stored = await storeImage(buf, hint);
  return { ...p, stored };
}

async function runVision(p: Payload): Promise<Payload> {
  if (!p.stored) throw new Error("Ingest has not produced an image yet.");
  const { analysis, modelLabel } = await analyzeScreenshot({
    base64Png: p.stored.visionBase64,
    palette: p.stored.palette as never,
    sourceUrl: p.sourceUrl,
    filename: p.filename,
    takenSlugs: allSlugs(),
    hint: p.hint,
  });
  return { ...p, analysis, modelLabel };
}

/**
 * Advance a job through its stages. Idempotent per stage, so a retry re-runs
 * only what failed — the stored payload carries prior stages' output forward.
 */
export async function runJob(id: string): Promise<void> {
  let payload = readPayload(id);
  const job = getJob(id);
  if (!job) return;

  run(`UPDATE jobs SET status = 'running' WHERE id = ?`, id);

  for (const stage of STAGES) {
    const state = job.stages.find((s) => s.stage === stage)!;
    if (state.status === "done") continue;
    // Review is a human gate, not work: park the job and wait.
    if (stage === "review") {
      run(`UPDATE jobs SET status = 'awaiting-review' WHERE id = ?`, id);
      mark(id, "review", "running");
      return;
    }

    mark(id, stage, "running");
    try {
      switch (stage) {
        case "ingest":
          payload = await runIngest(id, payload);
          writePayload(id, payload);
          break;

        case "vision":
          payload = await runVision(payload);
          writePayload(id, payload);
          break;

        case "derive": {
          // Artifacts are pure and rebuilt on save; deriving here is the
          // proof they generate cleanly before anything is committed.
          if (!payload.analysis) throw new Error("No analysis to derive from.");
          buildArtifacts(payload.analysis as never);
          break;
        }

        case "index": {
          if (!payload.analysis || !payload.stored) {
            throw new Error("Missing analysis or stored image.");
          }
          const provenance: Provenance = {
            sourceUrl: payload.sourceUrl,
            capturedAt: now(),
            captureKind: payload.kind === "url" ? "full-page" : "unknown",
            originalFilename: payload.filename,
          };
          const slug = createInspiration({
            analysis: payload.analysis as never,
            provenance,
            imagePath: payload.stored.imagePath,
            thumbPath: payload.stored.thumbPath,
            sha256: payload.stored.sha256,
            width: payload.stored.width,
            height: payload.stored.height,
            model: payload.modelLabel ?? "unknown",
          });
          run(`UPDATE jobs SET slug = ? WHERE id = ?`, slug, id);
          break;
        }
      }
      mark(id, stage, "done");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      mark(id, stage, "failed", message);
      run(`UPDATE jobs SET status = 'failed' WHERE id = ?`, id);
      return;
    }
  }
}

/** Retry from the failed stage. Earlier completed stages are not redone. */
export async function retryJob(id: string): Promise<void> {
  const job = getJob(id);
  if (!job) return;
  for (const s of job.stages) {
    if (s.status === "failed") {
      run(
        `UPDATE job_stages SET status = 'pending', error = NULL,
                started_at = NULL, finished_at = NULL
          WHERE job_id = ? AND stage = ?`,
        id,
        s.stage,
      );
    }
  }
  await runJob(id);
}

/** The human confirmed the result; the job is finished. */
export function completeReview(id: string): void {
  mark(id, "review", "done");
  run(`UPDATE jobs SET status = 'done' WHERE id = ?`, id);
}

export const dismissJob = (id: string): void =>
  run(`DELETE FROM jobs WHERE id = ?`, id);
