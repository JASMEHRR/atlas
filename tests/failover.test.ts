/**
 * End-to-end failover through the real chain, with the network stubbed.
 * These exercise `askJson` itself — catalogue fetch, model selection, the
 * call, JSON validation and the hand-off to the next provider.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

const Small = z.object({ name: z.string(), n: z.number() });

const { askJson, AllProvidersFailedError, clearNotices, getNotices } =
  await import("../src/lib/ai/index.ts");
const { __setGroqCatalogue } = await import("../src/lib/ai/groq.ts");
const { __setOpenRouterCatalogue } = await import("../src/lib/ai/openrouter.ts");
const { __setGeminiCatalogue } = await import("../src/lib/ai/gemini.ts");

const realFetch = globalThis.fetch;

/** Route stubbed responses by URL substring. */
type Route = (url: string, init: RequestInit) => Response | Promise<Response>;
let routes: Route[] = [];
const calls: string[] = [];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const chatOk = (content: unknown, model = "stub-model") =>
  json({ model, choices: [{ message: { content: JSON.stringify(content) }, finish_reason: "stop" }] });

const geminiOk = (content: unknown) =>
  json({ candidates: [{ content: { parts: [{ text: JSON.stringify(content) }] }, finishReason: "STOP" }] });

beforeEach(() => {
  calls.length = 0;
  routes = [];
  clearNotices();
  process.env.GROQ_API_KEY = "test-groq";
  process.env.OPENROUTER_API_KEY = "test-or";
  process.env.GEMINI_API_KEY = "test-gemini";
  delete process.env.ATLAS_VISION_MODEL;
  delete process.env.ATLAS_TEXT_MODEL;

  // Catalogues are pre-seeded so tests target the call path, not discovery.
  __setGroqCatalogue(["qwen/qwen3-vl-32b-instruct", "llama-3.1-8b-instant"]);
  __setOpenRouterCatalogue([
    {
      id: "qwen/qwen3-vl-72b:free",
      pricing: { prompt: "0", completion: "0" },
      architecture: { input_modalities: ["text", "image"] },
      context_length: 32000,
    },
  ]);
  __setGeminiCatalogue(["models/gemini-2.5-flash", "models/gemini-2.0-flash"]);

  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push(url);
    for (const route of routes) {
      const res = await route(url, init);
      if (res) return res;
    }
    throw new Error(`unstubbed request: ${url}`);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  __setGroqCatalogue(null);
  __setOpenRouterCatalogue(null);
  __setGeminiCatalogue(null);
});

const ask = () =>
  askJson({
    system: "s",
    prompt: "p",
    schema: Small,
    schemaName: "Small",
    image: { base64: "aGk=", mime: "image/png" },
  });

/* ---------------------------------------------------------------- */

test("Groq serves the request when healthy, and nothing else is contacted", async () => {
  routes = [(url) => (url.includes("groq.com") ? chatOk({ name: "a", n: 1 }) : undefined!)];

  const result = await ask();
  assert.equal(result.provider, "groq");
  assert.equal(result.data.name, "a");
  assert.equal(calls.some((c) => c.includes("openrouter")), false);
  assert.equal(calls.some((c) => c.includes("googleapis")), false);
});

test("Groq picks the Qwen vision model automatically", async () => {
  let sentModel = "";
  routes = [
    (url, init) => {
      if (!url.includes("groq.com")) return undefined!;
      sentModel = JSON.parse(String(init.body)).model;
      return chatOk({ name: "a", n: 1 });
    },
  ];
  await ask();
  assert.match(sentModel, /qwen.*vl/i);
});

test("a Groq rate limit fails over to OpenRouter", async () => {
  routes = [
    (url) => (url.includes("groq.com") ? json({ error: "rate limited" }, 429) : undefined!),
    (url) => (url.includes("openrouter") ? chatOk({ name: "b", n: 2 }) : undefined!),
  ];

  const result = await ask();
  assert.equal(result.provider, "openrouter");
  assert.equal(result.data.name, "b");
  assert.equal(result.attempts[0]!.provider, "groq");
  assert.match(result.attempts[0]!.detail, /rate-limited/);
});

test("a Groq outage (5xx) fails over", async () => {
  routes = [
    (url) => (url.includes("groq.com") ? json({}, 503) : undefined!),
    (url) => (url.includes("openrouter") ? chatOk({ name: "b", n: 2 }) : undefined!),
  ];
  assert.equal((await ask()).provider, "openrouter");
});

test("unparseable output from Groq fails over rather than corrupting data", async () => {
  routes = [
    // Both the first attempt and the in-place repair return junk.
    (url) => (url.includes("groq.com") ? chatOk("not the right shape") : undefined!),
    (url) => (url.includes("openrouter") ? chatOk({ name: "b", n: 2 }) : undefined!),
  ];
  const result = await ask();
  assert.equal(result.provider, "openrouter");
  assert.match(result.attempts[0]!.detail, /bad-output/);
});

test("a provider gets one repair attempt before it is abandoned", async () => {
  let groqCalls = 0;
  routes = [
    (url) => {
      if (!url.includes("groq.com")) return undefined!;
      groqCalls++;
      // Wrong shape first, correct after being told what was wrong.
      return groqCalls === 1
        ? chatOk({ name: "a", n: "oops" })
        : chatOk({ name: "a", n: 7 });
    },
  ];
  const result = await ask();
  assert.equal(groqCalls, 2, "should retry in place, not switch providers");
  assert.equal(result.provider, "groq");
  assert.equal(result.data.n, 7);
});

test("OpenRouter with no free vision model skips to Gemini and notifies the user", async () => {
  // Only a paid vision model is on offer.
  __setOpenRouterCatalogue([
    {
      id: "premium/vision-pro",
      pricing: { prompt: "0.000002", completion: "0.000004" },
      architecture: { input_modalities: ["text", "image"] },
      context_length: 128000,
    },
  ]);
  routes = [
    (url) => (url.includes("groq.com") ? json({}, 429) : undefined!),
    (url) => (url.includes("googleapis") ? geminiOk({ name: "c", n: 3 }) : undefined!),
  ];

  const result = await ask();
  assert.equal(result.provider, "gemini");
  // The paid model must never have been called.
  assert.equal(calls.some((c) => c.includes("openrouter")), false);

  const notice = getNotices().find((n) => n.provider === "openrouter");
  assert.ok(notice, "the user must be told a paid model was declined");
  assert.equal(notice!.kind, "no-free-model");
  assert.match(notice!.message, /will not/i);
});

test("Gemini is used only after both Groq and OpenRouter fail", async () => {
  routes = [
    (url) => (url.includes("groq.com") ? json({}, 500) : undefined!),
    (url) => (url.includes("openrouter") ? json({}, 500) : undefined!),
    (url) => (url.includes("googleapis") ? geminiOk({ name: "c", n: 3 }) : undefined!),
  ];
  const result = await ask();
  assert.equal(result.provider, "gemini");
  assert.deepEqual(
    result.attempts.map((a) => a.provider),
    ["groq", "openrouter", "gemini"],
  );
});

test("an unconfigured provider is skipped silently, not treated as a failure", async () => {
  delete process.env.GROQ_API_KEY;
  routes = [(url) => (url.includes("openrouter") ? chatOk({ name: "b", n: 2 }) : undefined!)];

  const result = await ask();
  assert.equal(result.provider, "openrouter");
  const groqAttempt = result.attempts.find((a) => a.provider === "groq")!;
  assert.equal(groqAttempt.outcome, "skipped");
  assert.match(groqAttempt.detail, /GROQ_API_KEY/);
});

test("when every provider fails the error names each one and why", async () => {
  routes = [
    (url) => (url.includes("groq.com") ? json({}, 500) : undefined!),
    (url) => (url.includes("openrouter") ? json({}, 500) : undefined!),
    (url) => (url.includes("googleapis") ? json({}, 500) : undefined!),
  ];

  await assert.rejects(ask(), (err: unknown) => {
    assert.ok(err instanceof AllProvidersFailedError);
    // Every provider is represented. The count is >= 3 rather than == 3
    // because a provider with several candidate models tries each of them.
    assert.deepEqual(
      [...new Set(err.attempts.map((a) => a.provider))],
      ["groq", "openrouter", "gemini"],
    );
    assert.ok(err.attempts.every((a) => a.outcome === "failed"));
    assert.match(err.message, /groq/);
    assert.match(err.message, /openrouter/);
    assert.match(err.message, /gemini/);
    return true;
  });
});

test("a rate-limited model falls to the next model on the SAME provider", async () => {
  // Two vision models on Groq; the higher-ranked one is rate-limited upstream.
  __setGroqCatalogue(["qwen/qwen3-vl-72b-instruct", "qwen/qwen2.5-vl-7b-instruct"]);

  const tried: string[] = [];
  routes = [
    (url, init) => {
      if (!url.includes("groq.com")) return undefined!;
      const model = JSON.parse(String(init.body)).model as string;
      tried.push(model);
      return model.includes("qwen3")
        ? json({ error: "rate limited" }, 429)
        : chatOk({ name: "same-provider", n: 1 });
    },
  ];

  const result = await ask();
  assert.equal(result.provider, "groq");
  assert.equal(result.data.name, "same-provider");
  assert.equal(tried.length, 2);
  // The provider was never abandoned — nothing downstream was contacted.
  assert.equal(calls.some((c) => c.includes("openrouter")), false);
  assert.equal(calls.some((c) => c.includes("googleapis")), false);
});

test("a model retired for new accounts (404) falls to the next Gemini model", async () => {
  delete process.env.GROQ_API_KEY;
  delete process.env.OPENROUTER_API_KEY;

  const tried: string[] = [];
  routes = [
    (url) => {
      if (!url.includes("googleapis")) return undefined!;
      const model = /models\/([^:]+):/.exec(url)?.[1] ?? "";
      tried.push(model);
      return model.includes("2.5")
        ? json({ error: { code: 404, message: "no longer available to new users" } }, 404)
        : geminiOk({ name: "fallback", n: 2 });
    },
  ];

  const result = await ask();
  assert.equal(result.provider, "gemini");
  assert.equal(result.data.name, "fallback");
  assert.deepEqual(tried, ["gemini-2.5-flash", "gemini-2.0-flash"]);
});

test("a provider-wide failure does not burn through its model list", async () => {
  __setGroqCatalogue(["qwen/qwen3-vl-72b-instruct", "qwen/qwen2.5-vl-7b-instruct"]);

  let groqCalls = 0;
  routes = [
    (url) => {
      if (!url.includes("groq.com")) return undefined!;
      groqCalls++;
      return json({ error: "invalid api key" }, 401);
    },
    (url) => (url.includes("openrouter") ? chatOk({ name: "b", n: 2 }) : undefined!),
  ];

  const result = await ask();
  assert.equal(result.provider, "openrouter");
  // 401 is about the key, not the model — trying model two would be pointless.
  assert.equal(groqCalls, 1);
});

test("with no keys at all the error explains exactly what to add", async () => {
  delete process.env.GROQ_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.GEMINI_API_KEY;

  await assert.rejects(ask(), (err: unknown) => {
    assert.match((err as Error).message, /GROQ_API_KEY/);
    assert.equal(/anthropic|openai/i.test((err as Error).message), false);
    return true;
  });
});

test("a text request uses a text model and sends no image", async () => {
  let body: Record<string, unknown> = {};
  routes = [
    (url, init) => {
      if (!url.includes("groq.com")) return undefined!;
      body = JSON.parse(String(init.body));
      return chatOk({ name: "a", n: 1 });
    },
  ];

  await askJson({ system: "s", prompt: "p", schema: Small, schemaName: "Small" });

  assert.match(String(body.model), /instant|8b/i, "should pick a fast text model");
  const content = (body.messages as Array<{ content: unknown }>)[1]!.content as Array<{
    type: string;
  }>;
  assert.equal(content.some((c) => c.type === "image_url"), false);
});

test("OpenRouter requests carry the free-only price ceiling", async () => {
  let body: Record<string, unknown> = {};
  routes = [
    (url) => (url.includes("groq.com") ? json({}, 429) : undefined!),
    (url, init) => {
      if (!url.includes("openrouter")) return undefined!;
      body = JSON.parse(String(init.body));
      return chatOk({ name: "b", n: 2 });
    },
  ];

  await ask();
  assert.deepEqual(body.max_price, { prompt: 0, completion: 0 });
});

test("a pinned model jumps the queue regardless of priority", async () => {
  process.env.ATLAS_VISION_MODEL = "gemini:gemini-2.0-flash";
  routes = [(url) => (url.includes("googleapis") ? geminiOk({ name: "c", n: 3 }) : undefined!)];

  const result = await ask();
  assert.equal(result.provider, "gemini");
  assert.equal(result.model, "gemini-2.0-flash");
  assert.equal(calls.some((c) => c.includes("groq.com")), false);
});
