"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { STAGES, type Job } from "@/lib/schema";
import { toast } from "./primitives";

const STAGE_LABEL: Record<string, string> = {
  ingest: "Ingest",
  vision: "Analyse",
  derive: "Derive",
  index: "Index",
  review: "Review",
};

/** Per-stage progress. Never a bare spinner — the live stage is always named. */
export function JobsDock() {
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const source = new EventSource("/api/jobs/stream");
    source.onmessage = (e) => {
      const next: Job[] = JSON.parse(e.data).jobs ?? [];
      setJobs(next);
    };
    source.onerror = () => source.close();
    return () => source.close();
  }, []);

  // Separate effect: when a job completes with a slug, refresh the grid
  useEffect(() => {
    const completed = jobs.filter((j) => j.status === "done" && j.slug);
    if (completed.length > 0) {
      router.refresh();
    }
  }, [jobs, router]);

  const live = jobs.filter((j) => j.status !== "done");
  if (live.length === 0) return null;

  const act = async (id: string, action: "retry" | "complete" | "dismiss") => {
    const res = await fetch(`/api/jobs/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (!res.ok) toast("Could not update that job.", "bad");
    if (action === "retry") toast("Retrying…");
    router.refresh();
  };

  return (
    <div className="fixed right-4 bottom-4 z-40 w-[min(26rem,calc(100vw-2rem))]">
      <div className="border border-rule-strong bg-paper-raised shadow-xl">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          className="label flex w-full items-center justify-between border-b border-rule px-4 py-2.5 text-ink-muted hover:text-ink"
        >
          <span>
            Pipeline
            <span className="ml-2 text-accent">{live.length}</span>
          </span>
          <span>{collapsed ? "Show" : "Hide"}</span>
        </button>

        {!collapsed && (
          <ul className="scrollbar-thin max-h-[50vh] divide-y divide-rule overflow-auto">
            {live.map((job) => (
              <li key={job.id} className="anim-fade-up px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-mono text-xs text-ink">
                    {job.label}
                  </span>
                  {job.slug && (
                    <Link
                      href={`/i/${job.slug}`}
                      className="label shrink-0 text-accent hover:underline"
                    >
                      {job.slug}
                    </Link>
                  )}
                </div>

                <ol className="mt-2.5 flex gap-1" aria-label="Pipeline stages">
                  {STAGES.map((name) => {
                    const stage = job.stages.find((s) => s.stage === name)!;
                    const tone =
                      stage.status === "done"
                        ? "bg-ok"
                        : stage.status === "failed"
                          ? "bg-bad"
                          : stage.status === "running"
                            ? "bg-accent anim-shimmer"
                            : "bg-rule";
                    return (
                      <li
                        key={name}
                        className="flex-1"
                        title={`${STAGE_LABEL[name]}: ${stage.status}`}
                      >
                        <span className={`block h-1 ${tone}`} />
                        <span
                          className={`label mt-1.5 block ${
                            stage.status === "running"
                              ? "text-accent"
                              : stage.status === "failed"
                                ? "text-bad"
                                : "text-ink-faint"
                          }`}
                        >
                          {STAGE_LABEL[name]}
                        </span>
                      </li>
                    );
                  })}
                </ol>

                {job.stages
                  .filter((s) => s.status === "failed" && s.error)
                  .map((s) => (
                    <p
                      key={s.stage}
                      className="mt-2.5 border border-bad/40 bg-bad/5 px-3 py-2 font-mono text-2xs text-bad"
                      role="alert"
                    >
                      {STAGE_LABEL[s.stage]} failed: {s.error}
                    </p>
                  ))}

                <div className="mt-2.5 flex gap-2">
                  {job.status === "failed" && (
                    <button
                      type="button"
                      onClick={() => act(job.id, "retry")}
                      className="chip hover:border-ink hover:text-ink"
                    >
                      Retry stage
                    </button>
                  )}
                  {job.status === "awaiting-review" && job.slug && (
                    <>
                      <Link
                        href={`/i/${job.slug}?review=1`}
                        className="chip border-accent text-accent hover:bg-accent hover:text-paper"
                      >
                        Review
                      </Link>
                      <button
                        type="button"
                        onClick={() => act(job.id, "complete")}
                        className="chip hover:border-ink hover:text-ink"
                      >
                        Looks right
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => act(job.id, "dismiss")}
                    className="chip ml-auto hover:border-ink hover:text-ink"
                  >
                    Dismiss
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
