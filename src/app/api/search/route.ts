import { SearchQuery } from "@/lib/schema";
import { facetCounts, search } from "@/lib/search";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const parsed = SearchQuery.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues }, { status: 400 });
  }
  const hits = await search(parsed.data);
  return Response.json({ hits, facets: facetCounts() });
}

export async function GET() {
  const hits = await search(SearchQuery.parse({}));
  return Response.json({ hits, facets: facetCounts() });
}
