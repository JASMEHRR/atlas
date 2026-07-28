import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { IMAGES_DIR } from "@/lib/db";
import { analyzeScreenshot } from "@/lib/analyze";
import { addAnalysisVersion, allSlugs, getInspiration } from "@/lib/repo";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({ hint: z.string().max(600).optional() });

/**
 * Re-analyse with an improved prompt. A new immutable analysis version is
 * written; human overrides live in a separate table and survive untouched.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const inspiration = getInspiration(slug);
  if (!inspiration) return Response.json({ error: "Not found" }, { status: 404 });

  const body = Body.safeParse(await req.json().catch(() => ({})));
  const file = path.join(IMAGES_DIR, path.basename(inspiration.imagePath));

  try {
    const buf = await readFile(file);
    const vision = await sharp(buf)
      .resize(1400, 1400, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();

    const { analysis, modelLabel } = await analyzeScreenshot({
      base64Png: vision.toString("base64"),
      palette: inspiration.analysis.color.palette,
      sourceUrl: inspiration.provenance.sourceUrl,
      filename: inspiration.provenance.originalFilename,
      // Exclude self so the slug isn't uniquified away from its own value.
      takenSlugs: allSlugs().filter((s) => s !== slug),
      hint: body.success ? body.data.hint : undefined,
    });

    addAnalysisVersion(slug, analysis, modelLabel);
    return Response.json({ inspiration: getInspiration(slug) });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
