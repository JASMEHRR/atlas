import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { rankByPreference, PROVIDERS, PROVIDER_ORDER, pinnedModel } from "../src/lib/ai/config.ts";
import { extractJson, parseWithSchema } from "../src/lib/ai/json.ts";
import { isFree, acceptsImages } from "../src/lib/ai/openrouter.ts";
import { toGeminiSchema } from "../src/lib/ai/gemini.ts";

beforeEach(() => {
  delete process.env.ATLAS_VISION_MODEL;
  delete process.env.ATLAS_TEXT_MODEL;
});

/* ---------------------------------------------------------------- */
/* Priority                                                          */
/* ---------------------------------------------------------------- */

test("provider priority is Groq, then OpenRouter, then Gemini", () => {
  assert.deepEqual(PROVIDER_ORDER, ["groq", "openrouter", "gemini"]);
});

test("no provider config references Anthropic or OpenAI as a vendor", () => {
  const serialised = JSON.stringify(
    PROVIDERS,
    (_k, v) => (v instanceof RegExp ? v.source : v),
  );
  assert.equal(/anthropic|claude/i.test(serialised), false);
  // "openai" appears only as the wire dialect name in a URL path, never as a
  // provider we call. api.openai.com must never appear.
  assert.equal(/api\.openai\.com/.test(serialised), false);
});

test("env keys are provider-specific and never Anthropic/OpenAI", () => {
  const keys = Object.values(PROVIDERS).map((p) => p.envKey);
  assert.deepEqual(keys, ["GROQ_API_KEY", "OPENROUTER_API_KEY", "GEMINI_API_KEY"]);
});

/* ---------------------------------------------------------------- */
/* Model selection                                                   */
/* ---------------------------------------------------------------- */

test("Groq vision selection prefers Qwen VL over other vision models", () => {
  const catalogue = [
    "llama-3.1-8b-instant",
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "qwen/qwen2.5-vl-32b-instruct",
    "meta-llama/llama-4-maverick-17b-128e-instruct",
  ];
  const ranked = rankByPreference(catalogue, PROVIDERS.groq.models.vision);
  assert.match(ranked[0]!.id, /qwen/i, "a Qwen VL model must win");
});

test("Groq prefers the newest Qwen VL generation when several are offered", () => {
  const ranked = rankByPreference(
    ["qwen/qwen2.5-vl-32b-instruct", "qwen/qwen3-vl-32b-instruct"],
    PROVIDERS.groq.models.vision,
  );
  assert.equal(ranked[0]!.id, "qwen/qwen3-vl-32b-instruct");
});

test("Groq still finds a vision model when no Qwen VL is offered", () => {
  const ranked = rankByPreference(
    ["llama-3.1-8b-instant", "meta-llama/llama-4-scout-17b-16e-instruct"],
    PROVIDERS.groq.models.vision,
  );
  assert.equal(ranked[0]!.id, "meta-llama/llama-4-scout-17b-16e-instruct");
});

test("a text-only catalogue yields no vision candidate rather than a wrong one", () => {
  const ranked = rankByPreference(
    ["llama-3.1-8b-instant", "gemma2-9b-it"],
    PROVIDERS.groq.models.vision,
  );
  assert.equal(ranked.length, 0, "must not send an image to a text-only model");
});

test("ranking is stable — equal ranks break ties deterministically", () => {
  const catalogue = ["qwen/qwen3-vl-b", "qwen/qwen3-vl-a"];
  const first = rankByPreference(catalogue, PROVIDERS.groq.models.vision);
  const second = rankByPreference([...catalogue].reverse(), PROVIDERS.groq.models.vision);
  assert.equal(first[0]!.id, second[0]!.id);
});

/* ---------------------------------------------------------------- */
/* OpenRouter free-tier enforcement — the money guarantee            */
/* ---------------------------------------------------------------- */

const free = (id: string, image = true) => ({
  id,
  pricing: { prompt: "0", completion: "0" },
  architecture: { input_modalities: image ? ["text", "image"] : ["text"] },
  context_length: 32000,
});

const paid = (id: string, image = true) => ({
  id,
  pricing: { prompt: "0.0000015", completion: "0.000002" },
  architecture: { input_modalities: image ? ["text", "image"] : ["text"] },
  context_length: 128000,
});

test("a zero-priced model is free; any non-zero price is not", () => {
  assert.equal(isFree(free("a/b")), true);
  assert.equal(isFree(paid("a/b")), false);
  assert.equal(
    isFree({ id: "x", pricing: { prompt: "0", completion: "0.001" } }),
    false,
    "one chargeable field is enough to make it paid",
  );
});

test("a model with no pricing block is treated as paid, not free", () => {
  // Failing open here would be the expensive kind of bug.
  assert.equal(isFree({ id: "unknown/model" }), false);
});

test("image capability is read from the catalogue, not guessed", () => {
  assert.equal(acceptsImages(free("a/b", true)), true);
  assert.equal(acceptsImages(free("a/b", false)), false);
  assert.equal(acceptsImages({ id: "x", architecture: { modality: "text+image->text" } }), true);
});

test("models that accept images but cannot describe a design are excluded", () => {
  // All of these appear in the live free+image-input catalogue and would be
  // selected by a naive largest-context fallback. None can write a brief.
  for (const id of [
    "nvidia/nemotron-3.5-content-safety:free",
    "google/lyria-3-pro-preview",
    "meta-llama/llama-guard-4-12b",
    "some/model-ocr-v2",
    "black-forest-labs/flux-1-schnell",
  ]) {
    assert.equal(
      acceptsImages(free(id)),
      false,
      `${id} must not be treated as a general vision model`,
    );
  }
  // …while genuine VLMs still pass.
  for (const id of [
    "google/gemma-4-26b-a4b-it:free",
    "nvidia/nemotron-nano-12b-v2-vl:free",
    "qwen/qwen3-vl-32b-instruct:free",
  ]) {
    assert.equal(acceptsImages(free(id)), true, `${id} should be usable`);
  }
});

test("a paid model is never a candidate, even when it is the only vision model", () => {
  const catalogue = [paid("premium/vision-pro"), free("small/text-only", false)];
  const candidates = catalogue.filter(isFree).filter(acceptsImages);
  assert.equal(candidates.length, 0, "no free vision model exists here");
  // The adapter must therefore raise no-free-model rather than fall back to
  // the paid one. See openrouter.selectModel.
  assert.equal(catalogue.filter(isFree).some(acceptsImages), false);
});

test("free vision models are ranked by quality preference", () => {
  const catalogue = [
    free("meta-llama/llama-4-scout:free"),
    free("qwen/qwen3-vl-235b-a22b-instruct:free"),
    free("some/unknown-vlm:free"),
  ];
  const ranked = rankByPreference(
    catalogue.filter(isFree).filter(acceptsImages).map((m) => m.id),
    PROVIDERS.openrouter.models.vision,
  );
  assert.match(ranked[0]!.id, /qwen/i);
});

/* ---------------------------------------------------------------- */
/* Gemini free tier                                                  */
/* ---------------------------------------------------------------- */

test("only free-tier Gemini families pass the gate", async () => {
  const { GEMINI_FREE_TIER } = await import("../src/lib/ai/config.ts");
  assert.equal(GEMINI_FREE_TIER.test("models/gemini-2.5-flash"), true);
  assert.equal(GEMINI_FREE_TIER.test("models/gemini-2.0-flash-lite"), true);
  assert.equal(GEMINI_FREE_TIER.test("models/gemini-2.5-pro"), false);
  assert.equal(GEMINI_FREE_TIER.test("models/gemini-1.0-ultra"), false);
});

test("Gemini schema conversion preserves properties and strips unsupported keywords", () => {
  const source = {
    type: "object",
    additionalProperties: false,
    $schema: "http://json-schema.org/draft-07/schema#",
    properties: {
      // A property literally named like a schema keyword must survive.
      required: { type: "string", minLength: 3 },
      mood: { type: "string", enum: ["calm", "loud"] },
      tags: { type: "array", minItems: 2, items: { type: "string", maxLength: 9 } },
    },
    required: ["mood", "tags"],
  };
  const out = toGeminiSchema(source) as Record<string, any>;

  assert.deepEqual(Object.keys(out.properties), ["required", "mood", "tags"]);
  assert.equal(out.additionalProperties, undefined);
  assert.equal(out.$schema, undefined);
  assert.deepEqual(out.properties.mood.enum, ["calm", "loud"]);
  assert.equal(out.properties.required.minLength, undefined, "minLength unsupported");
  assert.equal(out.properties.tags.minItems, 2, "minItems is supported");
  assert.deepEqual(out.required, ["mood", "tags"]);
});

/* ---------------------------------------------------------------- */
/* JSON coercion — open models are not tidy                          */
/* ---------------------------------------------------------------- */

const Small = z.object({ name: z.string(), n: z.number() });

test("plain JSON parses", () => {
  const r = parseWithSchema('{"name":"a","n":1}', Small);
  assert.equal(r.ok && r.data.name, "a");
});

test("fenced JSON parses", () => {
  const r = parseWithSchema('```json\n{"name":"a","n":1}\n```', Small);
  assert.equal(r.ok && r.data.n, 1);
});

test("JSON wrapped in prose parses", () => {
  const r = parseWithSchema('Sure! Here you go:\n{"name":"a","n":1}\nHope that helps.', Small);
  assert.equal(r.ok && r.data.name, "a");
});

test("a brace inside a string does not truncate the object", () => {
  const r = parseWithSchema('{"name":"a } b","n":2}', Small);
  assert.equal(r.ok && r.data.name, "a } b");
});

test("an escaped quote inside a string does not truncate the object", () => {
  const r = parseWithSchema('{"name":"say \\"hi\\"","n":2}', Small);
  assert.equal(r.ok && r.data.name, 'say "hi"');
});

test("a truncated response is repaired when only trailing data was lost", () => {
  const raw = '{"name":"a","n":3,';
  assert.equal(parseWithSchema(raw, Small).ok, true);
});

test("a schema violation is reported with the offending path, not swallowed", () => {
  const r = parseWithSchema('{"name":"a","n":"not-a-number"}', Small);
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /n:/);
});

test("a response with no JSON at all fails cleanly", () => {
  const r = parseWithSchema("I cannot help with that.", Small);
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /no JSON/i);
});

test("extractJson finds the first complete object among several", () => {
  const out = extractJson('{"a":1} trailing {"b":2}');
  assert.equal(out, '{"a":1}');
});

/* ---------------------------------------------------------------- */
/* Pinning                                                           */
/* ---------------------------------------------------------------- */

test("a pinned model is parsed into provider and id", () => {
  process.env.ATLAS_VISION_MODEL = "groq:qwen/qwen3-vl-32b-instruct";
  assert.deepEqual(pinnedModel("vision"), {
    provider: "groq",
    id: "qwen/qwen3-vl-32b-instruct",
  });
  assert.equal(pinnedModel("text"), null);
});

test("a malformed or unknown pin is ignored rather than crashing selection", () => {
  process.env.ATLAS_VISION_MODEL = "not-a-provider:model";
  assert.equal(pinnedModel("vision"), null);
  process.env.ATLAS_VISION_MODEL = "groq";
  assert.equal(pinnedModel("vision"), null);
});
