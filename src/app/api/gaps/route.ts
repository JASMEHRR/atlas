import { rows } from "@/lib/db";
import { gapAnalysis } from "@/lib/search";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    gaps: gapAnalysis(),
    mostUsed: rows<{ slug: string; use_count: number }>(
      `SELECT slug, use_count FROM inspirations
        WHERE use_count > 0 ORDER BY use_count DESC LIMIT 10`,
    ),
    total: rows<{ n: number }>(`SELECT COUNT(*) AS n FROM inspirations`)[0]?.n ?? 0,
  });
}
