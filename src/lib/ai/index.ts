/**
 * The public AI surface. Two functions, no provider vocabulary.
 *
 * Failover is automatic and requires no intervention: providers are tried in
 * configured priority order, and a provider is passed over for any reason that
 * another provider could plausibly fix (missing key, no suitable model, rate
 * limit, timeout, 5xx, unusable output). The first success wins.
 *
 * A provider is NOT retried on a different one for a schema violation caused
 * by the *request* — that would just burn the whole chain on a bad prompt —
 * so each provider gets one in-place repair attempt first.
 */
import { z } from "zod";
import { PROVIDER_ORDER, pinnedModel } from "./config.ts";
import { gemini } from "./gemini.ts";
import { groq } from "./groq.ts";
import { openrouter } from "./openrouter.ts";
import { parseWithSchema, repairInstruction } from "./json.ts";
import {
  ProviderError,
  RETRY_NEXT_MODEL,
  type AiResult,
  type Attempt,
  type Capability,
  type JsonRequest,
  type ModelChoice,
  type Notice,
  type ProviderAdapter,
  type ProviderId,
} from "./types.ts";

const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  groq,
  openrouter,
  gemini,
};

/* ------------------------------------------------------------------ */
/* Notices — things the user must be told, not silently swallowed.     */
/* ------------------------------------------------------------------ */

const notices: Notice[] = [];

/** Kinds worth interrupting the user for. Rate limits are routine; money is not. */
const USER_FACING = new Set(["no-free-model", "unauthorized"]);

function record(err: ProviderError): void {
  if (!USER_FACING.has(err.kind)) return;
  // De-duplicate: a failing provider must not flood the panel.
  const existing = notices.find(
    (n) => n.provider === err.provider && n.kind === err.kind,
  );
  if (existing) {
    existing.at = new Date().toISOString();
    return;
  }
  notices.push({
    provider: err.provider,
    kind: err.kind,
    message: err.message,
    at: new Date().toISOString(),
  });
  // Also make it visible to anyone watching the server log.
  console.warn(`[atlas:ai] ${err.provider}: ${err.message}`);
}

/** Is any provider usable at all? Callers use this to degrade gracefully. */
export const isConfigured = (): boolean =>
  PROVIDER_ORDER.some((id) => ADAPTERS[id].isConfigured());

export const getNotices = (): Notice[] => [...notices];
export const clearNotices = (): void => void notices.splice(0, notices.length);

/* ------------------------------------------------------------------ */
/* Core                                                                */
/* ------------------------------------------------------------------ */

export type AskOptions<T extends z.ZodType> = {
  system: string;
  prompt: string;
  schema: T;
  schemaName: string;
  image?: { base64: string; mime: string };
  maxOutputTokens?: number;
  temperature?: number;
};

export class AllProvidersFailedError extends Error {
  readonly attempts: Attempt[];

  constructor(attempts: Attempt[]) {
    super(buildFailureMessage(attempts));
    this.name = "AllProvidersFailedError";
    this.attempts = attempts;
  }
}

/**
 * Ask for structured JSON. Chooses a provider and model automatically.
 * Callers never name a provider — that is the whole contract.
 */
export async function askJson<T extends z.ZodType>(
  options: AskOptions<T>,
): Promise<AiResult<z.infer<T>>> {
  const capability: Capability = options.image ? "vision" : "text";
  const attempts: Attempt[] = [];

  const request: JsonRequest = {
    system: options.system,
    prompt: options.prompt,
    image: options.image,
    jsonSchema: toJsonSchema(options.schema),
    schemaName: options.schemaName,
    maxOutputTokens: options.maxOutputTokens ?? 16000,
    temperature: options.temperature,
  };

  for (const id of resolveOrder(capability)) {
    const adapter = ADAPTERS[id];

    if (!adapter.isConfigured()) {
      attempts.push({
        provider: id,
        model: null,
        outcome: "skipped",
        detail: `no API key (set ${envKeyFor(id)})`,
      });
      continue;
    }

    let models: ModelChoice[];
    try {
      models = await chooseModels(adapter, capability);
    } catch (err) {
      const pe = asProviderError(id, err);
      record(pe);
      attempts.push({
        provider: id,
        model: null,
        outcome: "skipped",
        detail: `${pe.kind}: ${pe.message}`,
      });
      continue;
    }

    // Walk this provider's candidates before moving to the next provider. A
    // rate-limited or retired model is a property of the model, not the
    // provider, and abandoning the provider over one is how a healthy chain
    // ends up reporting total failure.
    for (const model of models) {
      try {
        const data = await runWithRepair<z.infer<T>>(
          adapter,
          request,
          model,
          options.schema as z.ZodType<z.infer<T>>,
        );
        attempts.push({
          provider: id,
          model: model.id,
          outcome: "ok",
          detail: model.reason,
        });
        return { data, provider: id, model: model.id, attempts };
      } catch (err) {
        const pe = asProviderError(id, err);
        record(pe);
        attempts.push({
          provider: id,
          model: model.id,
          outcome: "failed",
          detail: `${pe.kind}: ${pe.message}`,
        });
        // Anything else is provider-wide (bad key, no credit): stop here.
        if (!RETRY_NEXT_MODEL.has(pe.kind)) break;
      }
    }
  }

  throw new AllProvidersFailedError(attempts);
}

/** One provider, one in-place repair attempt before giving up on it. */
async function runWithRepair<Out>(
  adapter: ProviderAdapter,
  request: JsonRequest,
  model: ModelChoice,
  schema: z.ZodType<Out>,
): Promise<Out> {
  const first = await adapter.complete(request, model);
  const parsed = parseWithSchema(first.text, schema);
  if (parsed.ok) return parsed.data;

  // The model produced something, just not the right shape. Telling it
  // exactly what was wrong is far cheaper than switching providers.
  const retry = await adapter.complete(
    {
      ...request,
      prompt: `${request.prompt}\n\n${repairInstruction(parsed.error)}`,
      temperature: 0,
    },
    model,
  );
  const second = parseWithSchema(retry.text, schema);
  if (second.ok) return second.data;

  throw new ProviderError(
    adapter.id,
    "bad-output",
    `output did not match ${request.schemaName} after a repair attempt — ${second.error}`,
  );
}

/**
 * How many models to try per provider before failing over. Enough to ride out
 * a rate-limited or retired head-of-list model; small enough that a genuinely
 * broken provider doesn't stall the chain.
 */
const MODELS_PER_PROVIDER = 4;

async function chooseModels(
  adapter: ProviderAdapter,
  capability: Capability,
): Promise<ModelChoice[]> {
  const pin = pinnedModel(capability);
  if (pin && pin.provider === adapter.id) {
    // An explicit pin is an instruction, not a suggestion — no alternatives.
    return [{ id: pin.id, reason: "pinned by configuration", free: true }];
  }
  return adapter.selectModels(capability, MODELS_PER_PROVIDER);
}

/** A pinned provider jumps the queue; everything else keeps priority order. */
function resolveOrder(capability: Capability): ProviderId[] {
  const pin = pinnedModel(capability);
  if (!pin) return PROVIDER_ORDER;
  return [pin.provider, ...PROVIDER_ORDER.filter((p) => p !== pin.provider)];
}

const envKeyFor = (id: ProviderId): string =>
  ({
    groq: "GROQ_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    gemini: "GEMINI_API_KEY",
  })[id];

function asProviderError(id: ProviderId, err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  return new ProviderError(
    id,
    "network",
    err instanceof Error ? err.message : String(err),
  );
}

function buildFailureMessage(attempts: Attempt[]): string {
  const configured = attempts.filter((a) => a.outcome !== "skipped");
  if (configured.length === 0) {
    return (
      "No AI provider is configured. Add at least one key to .env — " +
      "GROQ_API_KEY (recommended), OPENROUTER_API_KEY, or GEMINI_API_KEY."
    );
  }
  return (
    "Every configured AI provider failed:\n" +
    attempts.map((a) => `  • ${a.provider}: ${a.detail}`).join("\n")
  );
}

/**
 * Zod → JSON Schema. Providers vary in what they tolerate, so the output is
 * kept conservative: no $refs (inlined), no $schema key.
 */
function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const out = z.toJSONSchema(schema, {
    target: "draft-7",
    io: "output",
    // Inline everything — several hosted models mishandle $ref.
    reused: "inline",
  }) as Record<string, unknown>;
  delete out.$schema;
  return out;
}

/* ------------------------------------------------------------------ */
/* Diagnostics                                                         */
/* ------------------------------------------------------------------ */

export type ProviderStatus = {
  id: ProviderId;
  priority: number;
  configured: boolean;
  vision: { model: string; reason: string } | { error: string } | null;
  text: { model: string; reason: string } | { error: string } | null;
};

/** Powers the Export page panel. Never called on the ingest hot path. */
export async function providerStatus(): Promise<ProviderStatus[]> {
  return Promise.all(
    PROVIDER_ORDER.map(async (id, index) => {
      const adapter = ADAPTERS[id];
      const configured = adapter.isConfigured();
      if (!configured) {
        return { id, priority: index + 1, configured, vision: null, text: null };
      }

      const probe = async (capability: Capability) => {
        try {
          const m = await adapter.selectModel(capability);
          return { model: m.id, reason: m.reason };
        } catch (err) {
          return {
            error: err instanceof Error ? err.message : String(err),
          };
        }
      };

      return {
        id,
        priority: index + 1,
        configured,
        vision: await probe("vision"),
        text: await probe("text"),
      };
    }),
  );
}

export { PROVIDER_ORDER } from "./config.ts";
export type { Notice, ProviderId } from "./types.ts";
