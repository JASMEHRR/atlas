import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assignRoles,
  contrastRatio,
  deltaE,
  hexToLab,
  kmeans,
  rgbToHex,
} from "../src/lib/color.ts";
import { sha256 } from "../src/lib/images.ts";

/** Deterministic synthetic image: three colour blocks in fixed proportion. */
const pixels = (): Array<[number, number, number]> => {
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < 600; i++) out.push([244, 241, 234]); // warm paper
  for (let i = 0; i < 250; i++) out.push([26, 23, 20]); // ink
  for (let i = 0; i < 150; i++) out.push([184, 66, 42]); // rust accent
  return out;
};

test("k-means is deterministic — same pixels, same palette every run", () => {
  const a = kmeans(pixels(), 3).map((c) => rgbToHex(...c.rgb));
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(kmeans(pixels(), 3).map((c) => rgbToHex(...c.rgb)), a);
  }
});

test("k-means recovers the planted clusters and their proportions", () => {
  const clusters = kmeans(pixels(), 3);
  assert.equal(clusters.length, 3);
  // Sorted by weight; the paper block is 60% of the image.
  assert.ok(Math.abs(clusters[0]!.weight - 0.6) < 0.02);
  assert.ok(Math.abs(clusters[1]!.weight - 0.25) < 0.02);
  const hexes = clusters.map((c) => rgbToHex(...c.rgb));
  assert.ok(hexes.some((h) => deltaE(hexToLab(h), hexToLab("#f4f1ea")) < 3));
  assert.ok(hexes.some((h) => deltaE(hexToLab(h), hexToLab("#b8422a")) < 3));
});

test("roles are assigned by measured properties, not cluster order", () => {
  const swatches = assignRoles(kmeans(pixels(), 3));
  const byRole = Object.fromEntries(swatches.map((s) => [s.role, s.hex]));

  // Ground is the dominant colour, ink is furthest from it in lightness,
  // accent is the highest-chroma entry — regardless of frequency order.
  assert.ok(deltaE(hexToLab(byRole.ground!), hexToLab("#f4f1ea")) < 4);
  assert.ok(deltaE(hexToLab(byRole.ink!), hexToLab("#1a1714")) < 6);
  assert.ok(deltaE(hexToLab(byRole.accent!), hexToLab("#b8422a")) < 6);
});

test("a dark-ground image is not mislabelled as light", () => {
  const dark: Array<[number, number, number]> = [];
  for (let i = 0; i < 700; i++) dark.push([22, 21, 15]);
  for (let i = 0; i < 200; i++) dark.push([236, 231, 219]);
  for (let i = 0; i < 100; i++) dark.push([224, 117, 90]);

  const swatches = assignRoles(kmeans(dark, 3));
  const ground = swatches.find((s) => s.role === "ground")!;
  const ink = swatches.find((s) => s.role === "ink")!;
  assert.ok(hexToLab(ground.hex).l < 30, "ground should be dark");
  assert.ok(hexToLab(ink.hex).l > 70, "ink should be light against a dark ground");
});

test("deltaE is zero for identical colours and grows with real difference", () => {
  assert.ok(deltaE(hexToLab("#b8422a"), hexToLab("#b8422a")) < 0.001);
  // Near-identical reds stay within the 'same colour family' band.
  assert.ok(deltaE(hexToLab("#b8422a"), hexToLab("#bb4530")) < 5);
  // Red vs blue is unambiguously beyond it. Note CIEDE2000 compresses at the
  // top of its range — opposite hues land around 45, not 100. Thresholds
  // elsewhere in the app are calibrated to that, not to a linear intuition.
  assert.ok(deltaE(hexToLab("#b8422a"), hexToLab("#2563eb")) > 40);
});

test("contrast ratio matches known WCAG values", () => {
  assert.ok(Math.abs(contrastRatio("#000000", "#ffffff") - 21) < 0.01);
  assert.ok(Math.abs(contrastRatio("#ffffff", "#ffffff") - 1) < 0.01);
  // Order must not matter.
  assert.equal(
    contrastRatio("#1a1714", "#f4f1ea").toFixed(3),
    contrastRatio("#f4f1ea", "#1a1714").toFixed(3),
  );
});

test("dedupe hashing: identical bytes hash the same, one changed byte does not", () => {
  const a = Buffer.from("screenshot-bytes-aaaa");
  const b = Buffer.from("screenshot-bytes-aaaa");
  const c = Buffer.from("screenshot-bytes-aaab");
  assert.equal(sha256(a), sha256(b));
  assert.notEqual(sha256(a), sha256(c));
  assert.equal(sha256(a).length, 64);
});
