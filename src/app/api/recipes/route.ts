import { randomUUID } from "node:crypto";
import { z } from "zod";
import { now, rows, run } from "@/lib/db";
import { ComposeRequest, Recipe } from "@/lib/schema";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  name: string;
  version: number;
  request: string;
  created_at: string;
  updated_at: string;
};

const toRecipe = (r: Row) =>
  Recipe.parse({
    id: r.id,
    name: r.name,
    version: r.version,
    request: JSON.parse(r.request),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });

export async function GET() {
  return Response.json({
    recipes: rows<Row>(`SELECT * FROM recipes ORDER BY updated_at DESC`).map(
      toRecipe,
    ),
  });
}

const Save = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(80),
  request: ComposeRequest,
});

export async function POST(req: Request) {
  const parsed = Save.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues }, { status: 400 });
  }
  const { id, name, request } = parsed.data;
  const ts = now();

  if (id) {
    // Editing bumps the version — recipes are versioned, never overwritten
    // silently, so a saved reference keeps its provenance.
    const existing = rows<Row>(`SELECT * FROM recipes WHERE id = ?`, id)[0];
    if (!existing) return Response.json({ error: "Not found" }, { status: 404 });
    run(
      `UPDATE recipes SET name = ?, version = ?, request = ?, updated_at = ?
        WHERE id = ?`,
      name,
      existing.version + 1,
      JSON.stringify(request),
      ts,
      id,
    );
    return Response.json({
      recipe: toRecipe(rows<Row>(`SELECT * FROM recipes WHERE id = ?`, id)[0]!),
    });
  }

  const newId = randomUUID();
  run(
    `INSERT INTO recipes (id, name, version, request, created_at, updated_at)
     VALUES (?, ?, 1, ?, ?, ?)`,
    newId,
    name,
    JSON.stringify(request),
    ts,
    ts,
  );
  return Response.json({
    recipe: toRecipe(rows<Row>(`SELECT * FROM recipes WHERE id = ?`, newId)[0]!),
  });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  run(`DELETE FROM recipes WHERE id = ?`, id);
  return Response.json({ ok: true });
}
