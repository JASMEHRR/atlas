/** Hashing, thumbnails, and pixel sampling for the ingest stage. */
import sharp from "sharp";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { IMAGES_DIR } from "./db.ts";
import { assignRoles, kmeans } from "./color.ts";
import type { Swatch } from "./schema.ts";

export const sha256 = (buf: Buffer): string =>
  createHash("sha256").update(buf).digest("hex");

export type StoredImage = {
  sha256: string;
  imagePath: string;
  thumbPath: string;
  width: number;
  height: number;
  palette: Swatch[];
  /** Downscaled PNG for the vision call — full screenshots waste tokens. */
  visionBase64: string;
};

/**
 * Sample on a downscaled copy: 128px wide is plenty for cluster centres and
 * turns a 4MP screenshot into ~9k pixels, which k-means handles instantly.
 * Near-transparent pixels are dropped so a PNG's alpha border can't become
 * the "ground" colour.
 */
async function samplePixels(
  buf: Buffer,
): Promise<Array<[number, number, number]>> {
  const { data, info } = await sharp(buf)
    .resize(128, 128, { fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < data.length; i += info.channels) {
    if ((data[i + 3] ?? 255) < 200) continue;
    out.push([data[i]!, data[i + 1]!, data[i + 2]!]);
  }
  return out;
}

export async function storeImage(
  buf: Buffer,
  slugHint: string,
): Promise<StoredImage> {
  const hash = sha256(buf);
  const meta = await sharp(buf).metadata();

  const base = `${slugHint}-${hash.slice(0, 8)}`;
  const imageName = `${base}.png`;
  const thumbName = `${base}.thumb.webp`;

  const full = await sharp(buf).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(path.join(IMAGES_DIR, imageName), full);

  const thumb = await sharp(buf)
    .resize(720, 900, { fit: "cover", position: "top" })
    .webp({ quality: 82 })
    .toBuffer();
  await writeFile(path.join(IMAGES_DIR, thumbName), thumb);

  const vision = await sharp(buf)
    .resize(1400, 1400, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();

  return {
    sha256: hash,
    imagePath: `/api/images/${imageName}`,
    thumbPath: `/api/images/${thumbName}`,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    palette: assignRoles(kmeans(await samplePixels(buf), 8)),
    visionBase64: vision.toString("base64"),
  };
}

/** URL -> screenshot. Playwright is optional; absence is a clear message. */
export async function screenshotUrl(url: string): Promise<Buffer> {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new Error(
      "URL capture needs Playwright's browser. Run `npm run atlas:browser`, " +
        "or drop the screenshot in directly.",
    );
  }
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
    // Settle web fonts and entrance animations before capturing.
    await page.waitForTimeout(1200);
    return await page.screenshot({ fullPage: true, type: "png" });
  } finally {
    await browser.close();
  }
}
