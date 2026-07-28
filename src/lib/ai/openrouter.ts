/**
 * OpenRouter — secondary provider, FREE MODELS ONLY.
 *
 * This is the one place in the app that could quietly spend the user's money,
 * so the rule is enforced structurally rather than by convention:
 *
 *   1. The catalogue is filtered to zero-cost models BEFORE ranking, so a
 *      paid model is never a candidate — not even as a fallback.
 *   2. `max_price` is sent on the request as a server-side guarantee, in case
 *      pricing changed between our catalogue cache and the call.
 *   3. If nothing free can serve the request, we raise `no-free-model`, which
 *      surfaces as a user-facing notice and moves on to Gemini. We never
 *      "just this once" use a paid model.
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

type OrModel = {
  id: string;
  pricing?: { prompt?: string; completion?: string; image?: string };
  architecture?: { input_modalities?: string[]; modality?: string };
  context_length?: number;
};

let cache: { models: OrModel[]; at: number } | null = null;

const key = () => process.env.OPENROUTER_API_KEY ?? "";

/** Attribution headers OpenRouter asks integrators to send. */
const HEADERS = {
  "HTTP-Referer": "https://github.com/atlas-design-library",
  "X-Title": "Atlas design library",
};

/** Every price field must parse to exactly zero. Absent price is NOT free. */
export function isFree(model: OrModel): boolean {
  const fields = [
    model.pricing?.prompt,
    model.pricing?.completion,
    model.pricing?.image,
  ];
  // A missing pricing block means we cannot prove it is free — treat as paid.
  if (!model.pricing) return false;
  return fields.every((f) => {
    if (f === undefined || f === null) return true;
    const n = Number(f);
    return Number.isFinite(n) && n === 0;
  });
}

export function acceptsImages(model: OrModel): boolean {
  // A safety classifier or a music model may well accept an image; neither
  // can write a design brief. Exclude them before capability is considered.
  if (NOT_A_GENERAL_VLM.test(model.id)) return false;

  const modalities = model.architecture?.input_modalities;
  if (Array.isArray(modalities)) return modalities.includes("image");
  // Older catalogue entries only carry a combined modality string.
  return /image/i.test(model.architecture?.modality ?? "");
}

async function catalogue(): Promise<OrModel[]> {
  if (cache && Date.now() - cache.at < CATALOGUE_TTL_MS) return cache.models;
  const models = (await listModels("openrouter", key())) as unknown as OrModel[];
  cache = { models, at: Date.now() };
  return models;
}

export const openrouter: ProviderAdapter = {
  id: "openrouter",

  isConfigured: () => key().length > 0,

  async selectModel(capability: Capability): Promise<ModelChoice> {
    const all = await catalogue();

    // Order matters: free filter first, capability second, ranking last.
    const free = all.filter(isFree);
    const candidates =
      capability === "vision" ? free.filter(acceptsImages) : free;

    if (candidates.length === 0) {
      const paidThatWouldWork = all.filter(
        (m) => !isFree(m) && (capability !== "vision" || acceptsImages(m)),
      ).length;

      throw new ProviderError(
        "openrouter",
        "no-free-model",
        `OpenRouter currently has no free ${capability} model. ` +
          `${paidThatWouldWork} paid model(s) could do this, but Atlas will not ` +
          `use a paid model without being told to. Falling back to the next provider.`,
      );
    }

    const ranked = rankByPreference(
      candidates.map((m) => m.id),
      PROVIDERS.openrouter.models[capability],
    );

    // Unlike Groq, an unranked free model is still usable — prefer the one
    // with the largest context rather than giving up the provider entirely.
    const best =
      ranked[0]?.id ??
      [...candidates].sort(
        (a, b) => (b.context_length ?? 0) - (a.context_length ?? 0),
      )[0]!.id;

    return {
      id: best,
      reason: ranked[0]
        ? `${ranked[0].label} — best free ${capability} model on OpenRouter`
        : `largest-context free ${capability} model on OpenRouter`,
      free: true,
    };
  },

  complete(request: JsonRequest, model: ModelChoice): Promise<RawCompletion> {
    return chatComplete(
      "openrouter",
      key(),
      request,
      model,
      HEADERS,
      FREE_ONLY_BODY,
    );
  },
};

/**
 * Server-side price ceiling, sent on every request. Belt-and-braces against
 * the catalogue cache going stale: even if we picked wrongly, OpenRouter
 * rejects a chargeable request (402) rather than billing for it — and 402 is
 * classified as `no-free-model`, so it becomes a notice and a failover.
 */
export const FREE_ONLY_BODY = { max_price: { prompt: 0, completion: 0 } };

/** Test seam. */
export function __setOpenRouterCatalogue(models: OrModel[] | null): void {
  cache = models ? { models, at: Date.now() } : null;
}
