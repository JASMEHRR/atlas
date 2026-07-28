/**
 * The AI boundary.
 *
 * Everything outside `src/lib/ai/` speaks only these types. No caller knows
 * which provider answered, which model ran, or how failover was resolved —
 * that is the entire point of this module.
 */
import type { z } from "zod";

export type ProviderId = "groq" | "openrouter" | "gemini";

/** What a request needs from a model. Drives model selection per provider. */
export type Capability = "vision" | "text";

export type ModelChoice = {
  /** Provider-native model identifier. */
  id: string;
  /** Why this model was chosen — surfaced in diagnostics, never to callers. */
  reason: string;
  /** False only if the provider genuinely has no free option (OpenRouter). */
  free: boolean;
};

export type JsonRequest = {
  system: string;
  /** User-turn text. */
  prompt: string;
  /** Present only for vision requests. Raw base64, no data: prefix. */
  image?: { base64: string; mime: string };
  /** JSON Schema the model is asked to satisfy. */
  jsonSchema: Record<string, unknown>;
  schemaName: string;
  maxOutputTokens: number;
  /** Lower is more deterministic. Providers that ignore it are fine. */
  temperature?: number;
};

export type RawCompletion = {
  text: string;
  model: string;
};

/**
 * A provider adapter. Adding a fourth provider means implementing this and
 * adding one line to the config — nothing else in the codebase changes.
 */
export interface ProviderAdapter {
  readonly id: ProviderId;
  /** Cheap, synchronous: does this provider have credentials at all? */
  isConfigured(): boolean;
  /** Live catalogue lookup + preference ranking. Throws NoModelError. */
  selectModel(capability: Capability): Promise<ModelChoice>;
  /** Perform the call. Throws ProviderError on any failure. */
  complete(request: JsonRequest, model: ModelChoice): Promise<RawCompletion>;
}

/** Result handed back to the app. `provider`/`model` are for display only. */
export type AiResult<T> = {
  data: T;
  provider: ProviderId;
  model: string;
  /** Providers tried and rejected before this one succeeded. */
  attempts: Attempt[];
};

export type Attempt = {
  provider: ProviderId;
  model: string | null;
  outcome: "ok" | "skipped" | "failed";
  detail: string;
};

/** Why a provider was passed over. `fatal` stops the chain instead of failing over. */
export type FailureKind =
  | "unconfigured"
  | "no-model"
  | "no-free-model"
  | "rate-limited"
  | "unauthorized"
  | "server-error"
  | "timeout"
  | "bad-output"
  | "network";

// NB: fields are declared and assigned explicitly rather than as constructor
// parameter properties — `node --experimental-strip-types` (which runs the MCP
// server) only strips types and cannot desugar that syntax.
export class ProviderError extends Error {
  readonly provider: ProviderId;
  readonly kind: FailureKind;
  readonly status: number | undefined;

  constructor(
    provider: ProviderId,
    kind: FailureKind,
    message: string,
    status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
    this.kind = kind;
    this.status = status;
  }
}

/**
 * Something the user must actually be told — most importantly, that
 * OpenRouter had no free model, so Atlas declined to spend their money.
 * Collected rather than thrown, so failover continues.
 */
export type Notice = {
  provider: ProviderId;
  kind: FailureKind;
  message: string;
  at: string;
};

export type SchemaOf<T extends z.ZodType> = z.infer<T>;
