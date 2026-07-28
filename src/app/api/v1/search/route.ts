import { Facets, SearchQuery } from "@/lib/schema";
import { search } from "@/lib/search";
import { isConfigured } from "@/lib/ai";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const parsed = SearchQuery.safeParse({
    q: p.get("q") ?? "",
    limit: p.get("limit") ? Number(p.get("limit")) : 12,
    expand: Boolean(p.get("q")) && isConfigured(),
    facets: Facets.parse({
      family: p.getAll("family"),
      components: p.getAll("component"),
      moods: p.getAll("mood"),
      verifiedOnly: p.get("verified") === "true",
      color: p.get("color"),
      collection: p.get("collection"),
    }),
  });
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues }, { status: 400 });
  }
  return Response.json({ hits: await search(parsed.data) });
}
