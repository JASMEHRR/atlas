import { z } from "zod";
import { OverridableField } from "@/lib/schema";
import {
  clearOverride,
  deleteInspiration,
  getInspiration,
  overriddenFields,
  setNotes,
  setOverride,
  setVerified,
} from "@/lib/repo";
import { similar } from "@/lib/search";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const inspiration = getInspiration(slug);
  if (!inspiration) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({
    inspiration,
    similar: similar(slug),
    overridden: overriddenFields(slug),
  });
}

const Patch = z.object({
  override: z
    .object({ field: OverridableField, value: z.unknown() })
    .optional(),
  clearField: z.string().optional(),
  notes: z.string().max(4000).optional(),
  verified: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!getInspiration(slug)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const parsed = Patch.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues }, { status: 400 });
  }
  const body = parsed.data;

  if (body.override) setOverride(slug, body.override.field, body.override.value);
  if (body.clearField) clearOverride(slug, body.clearField);
  if (body.notes !== undefined) setNotes(slug, body.notes);
  if (body.verified !== undefined) setVerified(slug, body.verified);

  return Response.json({
    inspiration: getInspiration(slug),
    overridden: overriddenFields(slug),
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  deleteInspiration(slug);
  return Response.json({ ok: true });
}
