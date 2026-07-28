import { z } from "zod";
import {
  addToCollection,
  collectionSlugs,
  listCollections,
  removeFromCollection,
} from "@/lib/repo";
import { houseStyle } from "@/lib/compose";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const name = new URL(req.url).searchParams.get("name");
  if (name) {
    const slugs = collectionSlugs(name);
    return Response.json({ name, slugs, houseStyle: houseStyle(name, slugs) });
  }
  return Response.json({ collections: listCollections() });
}

const Body = z.object({
  name: z.string().min(1).max(60),
  slug: z.string(),
  action: z.enum(["add", "remove"]).default("add"),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues }, { status: 400 });
  }
  const { name, slug, action } = parsed.data;
  if (action === "add") addToCollection(name, slug);
  else removeFromCollection(name, slug);
  return Response.json({ collections: listCollections() });
}
