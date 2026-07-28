import { z } from "zod";
import { completeReview, dismissJob, getJob, retryJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({ action: z.enum(["retry", "complete", "dismiss"]) });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues }, { status: 400 });
  }

  switch (parsed.data.action) {
    case "retry":
      await retryJob(id);
      break;
    case "complete":
      completeReview(id);
      break;
    case "dismiss":
      dismissJob(id);
      return Response.json({ ok: true });
  }
  return Response.json({ job: getJob(id) });
}
