import { z } from "zod";
import path from "node:path";
import { exportSkill } from "@/lib/export";

export const dynamic = "force-dynamic";

const Body = z.object({ targetDir: z.string().min(1) });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues }, { status: 400 });
  }
  try {
    const target = path.resolve(parsed.data.targetDir);
    const { written, root } = await exportSkill(target);
    return Response.json({ root, count: written.length, written });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
