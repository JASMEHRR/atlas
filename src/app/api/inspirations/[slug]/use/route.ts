import { recordUse } from "@/lib/repo";

export const dynamic = "force-dynamic";

/** Fired whenever a slug's artifact is actually copied or resolved. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  recordUse(slug);
  return Response.json({ ok: true });
}
