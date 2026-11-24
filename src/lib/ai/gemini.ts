/**
 * Gemini — optional last resort. Free-tier model families only.
 *
 * Google's REST shape is its own thing (contents/parts/inlineData), so this
 * adapter does not share the OpenAI-compatible path. It does get one genuine
 * advantage in return: `responseSchema` is enforced server-side, so the JSON
 * comes back already conforming.
 */
import {
  CATALOGUE_TTL_MS,
  GEMINI_FREE_TIER,
  PROVIDERS,
  rankByPreference,
} from "./config.ts";
import { getJson, postJson } from "./http.ts";
import { schemaInstruction } from "./json.ts";
import {
  ProviderError,
  type Capability,
  type JsonRequest,
  type ModelChoice,
  type ProviderAdapter,
  type RawCompletion,
} from "./types.ts";

type GeminiModel = {
  name?: string;
  supportedGenerationMethods?: string[];
};

let cache: { names: string[]; at: number } | null = null;

const key = () => process.env.GEMINI_API_KEY ?? "";

async function catalogue(): Promise<string[]> {
  if (cache && Date.now() - cache.at < CATALOGUE_TTL_MS) return cache.names;

  const payload = (await getJson(
    "gemini",
    `${PROVIDERS.gemini.baseUrl}/models?key=${encodeURIComponent(key())}`,
    {},
    PROVIDERS.gemini.requestTimeoutMs,
  )) as { models?: GeminiModel[] };

  const names = (payload.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => String(m.name ?? ""))
    // Enforced regardless of the preference patterns: never select a family
    // that has no free tier.
    .filter((n) => GEMINI_FREE_TIER.test(n));

  cache = { names, at: Date.now() };
  return names;
}

export const gemini: ProviderAdapter = {
  id: "gemini",

  isConfigured: () => key().length > 0,

  async selectModels(
    capability: Capability,
    limit: number,
  ): Promise<ModelChoice[]> {
    const names = await catalogue();
    if (names.length === 0) {
      throw new ProviderError(
        "gemini",
        "no-free-model",
        "no free-tier Gemini model is available to this key",
      );
    }

    const ranked = rankByPreference(names, PROVIDERS.gemini.models[capability]);

    const choices: ModelChoice[] = ranked.map((m) => ({
      id: m.id.replace(/^models\//, ""),
      reason: `${m.label} — free-tier ${capability} model`,
      free: true,
    }));

    // Google retires models for new accounts while still listing them, so keep
    // the unranked free-tier names as backups rather than a single choice.
    const seen = new Set(choices.map((c) => c.id));
    for (const n of names) {
      const id = n.replace(/^models\//, "");
      if (seen.has(id)) continue;
      choices.push({
        id,
        reason: "other free-tier Gemini model",
        free: true,
      });
    }

    return choices.slice(0, limit);
  },

  async selectModel(capability: Capability): Promise<ModelChoice> {
    return (await this.selectModels(capability, 1))[0]!;
  },

  async complete(request: JsonRequest, model: ModelChoice): Promise<RawCompletion> {
    const cfg = PROVIDERS.gemini;

    const parts: Array<Record<string, unknown>> = [];
    if (request.image) {
      parts.push({
        inlineData: { mimeType: request.image.mime, data: request.image.base64 },
      });
    }
    parts.push({ text: request.prompt });

    const body = {
      systemInstruction: {
        parts: [
          {
            text: `${request.system}\n\n${schemaInstruction(
              request.schemaName,
              request.jsonSchema,
            )}`,
          },
        ],
      },
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: request.temperature ?? 0.2,
        maxOutputTokens: Math.min(request.maxOutputTokens, cfg.maxOutputTokens),
        responseMimeType: "application/json",
        responseSchema: toGeminiSchema(request.jsonSchema),
      },
    };

    const payload = (await postJson(
      "gemini",
      `${cfg.baseUrl}/models/${encodeURIComponent(model.id)}:generateContent?key=${encodeURIComponent(key())}`,
      body,
      {},
      cfg.requestTimeoutMs,
    )) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
      promptFeedback?: { blockReason?: string };
    };

    if (payload.promptFeedback?.blockReason) {
      throw new ProviderError(
        "gemini",
        "bad-output",
        `request blocked: ${payload.promptFeedback.blockReason}`,
      );
    }

    const candidate = payload.candidates?.[0];
    const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text.trim()) {
      throw new ProviderError(
        "gemini",
        "bad-output",
        `empty completion (finishReason: ${candidate?.finishReason ?? "unknown"})`,
      );
    }

    return { text, model: model.id };
  },
};

/**
 * Google's responseSchema is a restricted OpenAPI dialect: no $schema, no
 * additionalProperties, no const, and `format` only for a few known values.
 * Passing an unsupported keyword rejects the whole request, so strip rather
 * than hope.
 */
export function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (schema === null || typeof schema !== "object") return schema;

  const allowed = new Set([
    "type",
    "format",
    "description",
    "nullable",
    "enum",
    "items",
    "properties",
    "required",
    "propertyOrdering",
    "anyOf",
    "minItems",
    "maxItems",
  ]);

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (!allowed.has(k)) continue;
    // Gemini only understands these two string formats.
    if (k === "format" && !["date-time", "enum"].includes(String(v))) continue;

    // `properties` is a MAP whose keys are property names, not schema
    // keywords. Recurse into the values but never filter the keys — doing so
    // silently empties the schema, which Gemini accepts and then ignores.
    if (k === "properties" && v && typeof v === "object" && !Array.isArray(v)) {
      const props: Record<string, unknown> = {};
      for (const [name, sub] of Object.entries(v as Record<string, unknown>)) {
        props[name] = toGeminiSchema(sub);
      }
      out[k] = props;
      continue;
    }

    out[k] = toGeminiSchema(v);
  }
  return out;
}

/** Test seam. */
export function __setGeminiCatalogue(names: string[] | null): void {
  cache = names ? { names, at: Date.now() } : null;
}
