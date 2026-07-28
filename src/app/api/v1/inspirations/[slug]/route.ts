import { getInspiration, recordUse } from "@/lib/repo";
import { similar } from "@/lib/search";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const i = getInspiration(slug);
  if (!i) return Response.json({ error: `No reference "${slug}"` }, { status: 404 });

  const section = new URL(req.url).searchParams.get("section") ?? "prompt";
  recordUse(slug);

  const content =
    section === "brief"
      ? i.artifacts.brief
      : section === "tokens"
        ? i.artifacts.tokenSet
        : section === "all"
          ? `${i.artifacts.claudePrompt}\n\n---\n\n${i.artifacts.tokenSet}\n\n---\n\n${i.artifacts.brief}`
          : i.artifacts.claudePrompt;

  return Response.json({
    slug: i.slug,
    name: i.analysis.identity.name,
    dna: i.analysis.identity.dna,
    humanVerified: i.humanVerified,
    qualityScore: i.qualityScore,
    section,
    content,
    related: similar(slug, 3).map((r) => ({ slug: r.slug, dna: r.dna })),
  });
}
