import { ComposeRequest } from "@/lib/schema";
import { compose } from "@/lib/compose";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const parsed = ComposeRequest.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues }, { status: 400 });
  }
  try {
    return Response.json(compose(parsed.data));
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
