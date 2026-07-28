/**
 * Programmatic colour: sRGB -> CIELAB, k-means clustering, role assignment,
 * CIEDE2000 distance. The model is told the *measured* palette so it reasons
 * about actual hex values rather than guessing from an impression.
 */
import type { ColorRole, Swatch } from "./schema.ts";

export type Lab = { l: number; a: number; b: number };

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

export const rgbToHex = (r: number, g: number, b: number): string =>
  "#" +
  [r, g, b]
    .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"))
    .join("");

export function rgbToLab(r: number, g: number, b: number): Lab {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  // sRGB D65
  const x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  const y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883;
  const f = (t: number) =>
    t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export const hexToLab = (hex: string): Lab => rgbToLab(...hexToRgb(hex));

/** CIEDE2000. Worth the arithmetic — CIE76 misreads near-neutrals badly. */
export function deltaE(x: Lab, y: Lab): number {
  const kL = 1, kC = 1, kH = 1;
  const c1 = Math.hypot(x.a, x.b);
  const c2 = Math.hypot(y.a, y.b);
  const cBar = (c1 + c2) / 2;
  const g =
    0.5 * (1 - Math.sqrt(Math.pow(cBar, 7) / (Math.pow(cBar, 7) + 25 ** 7)));
  const a1p = (1 + g) * x.a;
  const a2p = (1 + g) * y.a;
  const c1p = Math.hypot(a1p, x.b);
  const c2p = Math.hypot(a2p, y.b);
  const deg = (rad: number) => ((rad * 180) / Math.PI + 360) % 360;
  const h1p = c1p === 0 ? 0 : deg(Math.atan2(x.b, a1p));
  const h2p = c2p === 0 ? 0 : deg(Math.atan2(y.b, a2p));

  const dLp = y.l - x.l;
  const dCp = c2p - c1p;
  let dhp = 0;
  if (c1p * c2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin((dhp * Math.PI) / 360);

  const lBar = (x.l + y.l) / 2;
  const cBarP = (c1p + c2p) / 2;
  let hBarP = h1p + h2p;
  if (c1p * c2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hBarP += hBarP < 360 ? 360 : -360;
    hBarP /= 2;
  }
  const rad = (d: number) => (d * Math.PI) / 180;
  const t =
    1 -
    0.17 * Math.cos(rad(hBarP - 30)) +
    0.24 * Math.cos(rad(2 * hBarP)) +
    0.32 * Math.cos(rad(3 * hBarP + 6)) -
    0.2 * Math.cos(rad(4 * hBarP - 63));
  const sL =
    1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2);
  const sC = 1 + 0.045 * cBarP;
  const sH = 1 + 0.015 * cBarP * t;
  const rT =
    -2 *
    Math.sqrt(Math.pow(cBarP, 7) / (Math.pow(cBarP, 7) + 25 ** 7)) *
    Math.sin(rad(60 * Math.exp(-(((hBarP - 275) / 25) ** 2))));

  return Math.sqrt(
    (dLp / (kL * sL)) ** 2 +
      (dCp / (kC * sC)) ** 2 +
      (dHp / (kH * sH)) ** 2 +
      rT * (dCp / (kC * sC)) * (dHp / (kH * sH)),
  );
}

/** WCAG relative luminance, for the contrast note we compute ourselves. */
export function luminance(hex: string): number {
  const chan = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m) as [
    number,
    number,
  ];
  return (x + 0.05) / (y + 0.05);
}

/**
 * k-means in Lab space. Deterministic: k-means++ seeding driven by a fixed
 * LCG, so the same image always yields the same palette (the dedupe and the
 * tests both depend on that).
 */
export function kmeans(
  pixels: Array<[number, number, number]>,
  k: number,
  iterations = 24,
): Array<{ rgb: [number, number, number]; weight: number }> {
  if (pixels.length === 0) return [];
  const k2 = Math.min(k, pixels.length);
  const labs = pixels.map(([r, g, b]) => rgbToLab(r, g, b));

  let seed = 0x2f6e2b1;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  // k-means++ seeding: first centroid random, rest weighted by distance².
  const centroids: Lab[] = [labs[Math.floor(rand() * labs.length)]!];
  while (centroids.length < k2) {
    const d2 = labs.map((p) =>
      Math.min(
        ...centroids.map(
          (c) => (p.l - c.l) ** 2 + (p.a - c.a) ** 2 + (p.b - c.b) ** 2,
        ),
      ),
    );
    const total = d2.reduce((s, v) => s + v, 0);
    if (total === 0) break;
    let target = rand() * total;
    let idx = 0;
    for (let i = 0; i < d2.length; i++) {
      target -= d2[i]!;
      if (target <= 0) {
        idx = i;
        break;
      }
    }
    centroids.push(labs[idx]!);
  }

  let assign = new Array<number>(labs.length).fill(0);
  for (let iter = 0; iter < iterations; iter++) {
    let moved = false;
    for (let i = 0; i < labs.length; i++) {
      const p = labs[i]!;
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const q = centroids[c]!;
        const d = (p.l - q.l) ** 2 + (p.a - q.a) ** 2 + (p.b - q.b) ** 2;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (assign[i] !== best) {
        assign[i] = best;
        moved = true;
      }
    }
    if (!moved && iter > 0) break;
    const sums = centroids.map(() => ({ l: 0, a: 0, b: 0, n: 0 }));
    for (let i = 0; i < labs.length; i++) {
      const s = sums[assign[i]!]!;
      const p = labs[i]!;
      s.l += p.l; s.a += p.a; s.b += p.b; s.n++;
    }
    for (let c = 0; c < centroids.length; c++) {
      const s = sums[c]!;
      if (s.n > 0) centroids[c] = { l: s.l / s.n, a: s.a / s.n, b: s.b / s.n };
    }
  }

  // Average the *sRGB* members of each cluster — averaging Lab and converting
  // back drifts noticeably on saturated clusters.
  const acc = centroids.map(() => ({ r: 0, g: 0, b: 0, n: 0 }));
  for (let i = 0; i < pixels.length; i++) {
    const s = acc[assign[i]!]!;
    const [r, g, b] = pixels[i]!;
    s.r += r; s.g += g; s.b += b; s.n++;
  }
  return acc
    .filter((s) => s.n > 0)
    .map((s) => ({
      rgb: [s.r / s.n, s.g / s.n, s.b / s.n] as [number, number, number],
      weight: s.n / pixels.length,
    }))
    .sort((x, y) => y.weight - x.weight);
}

/**
 * Assign roles by measured properties, not by cluster order:
 * ground/surface = the two most common near-neutrals, ink = darkest against
 * ground, accent = highest chroma. Ordering by frequency alone mislabels
 * a dark hero band as "ground" on light-themed pages.
 */
export function assignRoles(
  clusters: Array<{ rgb: [number, number, number]; weight: number }>,
): Swatch[] {
  if (clusters.length === 0) return [];
  const enriched = clusters.map((c) => {
    const hex = rgbToHex(...c.rgb);
    const lab = hexToLab(hex);
    return { hex, weight: c.weight, lab, chroma: Math.hypot(lab.a, lab.b) };
  });

  const byWeight = [...enriched].sort((a, b) => b.weight - a.weight);
  const ground = byWeight[0]!;
  const groundIsLight = ground.lab.l > 50;

  const taken = new Set<string>([ground.hex]);
  const pick = (
    pool: typeof enriched,
    score: (e: (typeof enriched)[number]) => number,
  ) => {
    const cand = pool
      .filter((e) => !taken.has(e.hex))
      .sort((a, b) => score(b) - score(a))[0];
    if (cand) taken.add(cand.hex);
    return cand;
  };

  // Ink is the entry furthest in lightness from the ground.
  const ink = pick(enriched, (e) => Math.abs(e.lab.l - ground.lab.l));
  const accent = pick(enriched, (e) => e.chroma);
  const accent2 = pick(enriched, (e) => e.chroma);
  // Surface sits close to ground in lightness but isn't ground.
  const surface = pick(enriched, (e) => -Math.abs(e.lab.l - ground.lab.l));
  const inkMuted = ink
    ? pick(enriched, (e) => -Math.abs(e.lab.l - (ground.lab.l + ink.lab.l) / 2))
    : undefined;

  const out: Swatch[] = [];
  const push = (
    e: (typeof enriched)[number] | undefined,
    role: ColorRole,
    note: string,
  ) => {
    if (e) out.push({ hex: e.hex, role, weight: e.weight, note });
  };

  push(ground, "ground", groundIsLight ? "dominant light ground" : "dominant dark ground");
  push(surface, "surface", "raised panel / secondary ground");
  push(ink, "ink", "primary text weight against the ground");
  push(inkMuted, "ink-muted", "secondary text / meta");
  push(accent, "accent", "highest-chroma emphasis colour");
  push(accent2, "accent-secondary", "supporting emphasis");

  // Anything left over is incidental texture rather than a system colour.
  for (const e of enriched) {
    if (!taken.has(e.hex) && out.length < 10) {
      out.push({ hex: e.hex, role: "subtle", weight: e.weight, note: "incidental" });
      taken.add(e.hex);
    }
  }
  return out;
}
