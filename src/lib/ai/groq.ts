/**
 * Groq — primary provider. Picked for latency; Qwen VL preferred for vision.
 *
 * Groq's /models response carries no modality flag, so vision capability is
 * inferred from the configured patterns rather than probed. That is why the
 * vision preference list ends with known-VLM families instead of a catch-all:
 * sending an image to a text-only model would fail the request, and a wrong
 * guess here would burn the primary provider on every single ingest.
 */
import {
  CATALOGUE_TTL_MS,
  NOT_A_GENERAL_VLM,
  PROVIDERS,
  rankByPreference,
} from "./config.ts";
import { chatComplete, listModels } from "./openai-compatible.ts";
import {
  ProviderError,
  type Capability,
  type JsonRequest,
  type ModelChoice,
  type ProviderAdapter,
  type RawCompletion,
} from "./types.ts";

let cache: { ids: string[]; at: number } | null = null;

const key = () => process.env.GROQ_API_KEY ?? "";

async function catalogue(): Promise<string[]> {
  if (cache && Date.now() - cache.at < CATALOGUE_TTL_MS) return cache.ids;

  const models = await listModels("groq", key());
  const ids = models
    // `active: false` models are listed but will not serve traffic.
    .filter((m) => m.active !== false)
    .map((m) => String(m.id ?? ""))
    .filter(Boolean);

  cache = { ids, at: Date.now() };
  return ids;
}

export const groq: ProviderAdapter = {
  id: "groq",

  isConfigured: () => key().length > 0,

  async selectModels(
    capability: Capability,
    limit: number,
  ): Promise<ModelChoice[]> {
    const ids = await catalogue();
    if (ids.length === 0) {
      throw new ProviderError("groq", "no-model", "Groq returned an empty catalogue");
    }

    const usable =
      capability === "vision" ? ids.filter((id) => !NOT_A_GENERAL_VLM.test(id)) : ids;
    const ranked = rankByPreference(usable, PROVIDERS.groq.models[capability]);

    if (ranked.length === 0) {
      throw new ProviderError(
        "groq",
        "no-model",
        `no ${capability} model on Groq matched the configured preferences. ` +
          `Run \`npm run debug:providers\` to see the full catalogue, then add a ` +
          `pattern in src/lib/ai/config.ts (catalogue: ` +
          `${ids.slice(0, 8).join(", ")}${ids.length > 8 ? ", …" : ""})`,
      );
    }

    // Groq's free tier is rate-limited rather than model-gated, so any model
    // the key can reach is usable without a spend decision.
    return ranked.slice(0, limit).map((m) => ({
      id: m.id,
      reason: `${m.label} — ranked ${capability} match on Groq`,
      free: true,
    }));
  },

  async selectModel(capability: Capability): Promise<ModelChoice> {
    return (await this.selectModels(capability, 1))[0]!;
  },

  complete(request: JsonRequest, model: ModelChoice): Promise<RawCompletion> {
    return chatComplete("groq", key(), request, model);
  },
};

/** Test seam — lets the suite exercise selection without a live catalogue. */
export function __setGroqCatalogue(ids: string[] | null): void {
  cache = ids ? { ids, at: Date.now() } : null;
}
