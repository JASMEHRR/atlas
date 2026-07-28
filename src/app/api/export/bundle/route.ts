import { exportBundle, importBundle } from "@/lib/export";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const bundle = await exportBundle();
  return new Response(JSON.stringify(bundle), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="atlas-${bundle.exportedAt.slice(0, 10)}.json"`,
    },
  });
}

export async function POST(req: Request) {
  try {
    return Response.json(await importBundle(await req.json()));
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
