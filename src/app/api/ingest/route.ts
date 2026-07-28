import { z } from "zod";
import { createJob, listJobs, runJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Item = z.union([
  z.object({
    kind: z.literal("image"),
    /** base64 PNG/JPEG/WebP payload (drag-drop, paste, or file picker). */
    data: z.string().min(16),
    filename: z.string().max(200).nullable().default(null),
    hint: z.string().max(600).optional(),
  }),
  z.object({
    kind: z.literal("url"),
    url: z.string().url(),
    hint: z.string().max(600).optional(),
  }),
]);

const Body = z.object({ items: z.array(Item).min(1).max(40) });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues }, { status: 400 });
  }

  const ids = parsed.data.items.map((item) =>
    item.kind === "url"
      ? createJob({
          label: item.url.replace(/^https?:\/\//, "").slice(0, 60),
          kind: "url",
          source: item.url,
          sourceUrl: item.url,
          hint: item.hint,
        })
      : createJob({
          label: item.filename ?? "pasted image",
          kind: "image",
          source: item.data,
          filename: item.filename,
          hint: item.hint,
        }),
  );

  // Run in the background; the client watches the job stream. Sequential on
  // purpose — parallel vision calls on a batch upload just trip rate limits.
  void (async () => {
    for (const id of ids) {
      try {
        await runJob(id);
      } catch {
        /* runJob records its own failures on the stage row */
      }
    }
  })();

  return Response.json({ jobIds: ids, jobs: listJobs() });
}
