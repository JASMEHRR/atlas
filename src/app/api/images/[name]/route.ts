import { readFile } from "node:fs/promises";
import path from "node:path";
import { IMAGES_DIR } from "@/lib/db";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  // basename before join: the segment is user-influenced (it comes from the
  // stored path) and must never be able to escape the images directory.
  const safe = path.basename(name);
  const file = path.join(IMAGES_DIR, safe);
  if (path.dirname(file) !== IMAGES_DIR) {
    return new Response("Bad path", { status: 400 });
  }

  try {
    const buf = await readFile(file);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": TYPES[path.extname(safe).toLowerCase()] ?? "application/octet-stream",
        // Filenames are content-hashed, so they are safe to cache hard.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
