/**
 * Groq and OpenRouter both speak the OpenAI chat-completions dialect, so the
 * request shape is shared. They differ only in how a model is chosen — which
 * is exactly where their rules diverge (Qwen-first vs free-tier-only), so
 * that part is injected.
 */
import { PROVIDERS } from "./config.ts";
import { getJson, postJson } from "./http.ts";
import { schemaInstruction } from "./json.ts";
import {
  ProviderError,
  type JsonRequest,
  type ModelChoice,
  type ProviderId,
  type RawCompletion,
} from "./types.ts";

type ChatResponse = {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  model?: string;
  error?: { message?: string; code?: string | number };
};

export async function chatComplete(
  provider: ProviderId,
  apiKey: string,
  request: JsonRequest,
  model: ModelChoice,
  extraHeaders: Record<string, string> = {},
  /** Merged into the request body — OpenRouter uses it for its price ceiling. */
  extraBody: Record<string, unknown> = {},
): Promise<RawCompletion> {
  const cfg = PROVIDERS[provider];

  const content: Array<Record<string, unknown>> = [];
  if (request.image) {
    content.push({
      type: "image_url",
      image_url: {
        url: `data:${request.image.mime};base64,${request.image.base64}`,
      },
    });
  }
  content.push({
    type: "text",
    text: `${request.prompt}\n\n${schemaInstruction(request.schemaName, request.jsonSchema)}`,
  });

  const body: Record<string, unknown> = {
    model: model.id,
    messages: [
      { role: "system", content: request.system },
      { role: "user", content },
    ],
    max_tokens: Math.min(request.maxOutputTokens, cfg.maxOutputTokens),
    temperature: request.temperature ?? 0.2,
    // Native JSON mode where supported. Some catalogue models reject it; the
    // retry below drops it rather than losing the provider over a flag.
    response_format: { type: "json_object" },
    stream: false,
    ...extraBody,
  };

  let payload: unknown;
  try {
    payload = await postJson(
      provider,
      `${cfg.baseUrl}/chat/completions`,
      body,
      { Authorization: `Bearer ${apiKey}`, ...extraHeaders },
      cfg.requestTimeoutMs,
    );
  } catch (err) {
    // A 400 here is very often "this model does not support response_format".
    if (err instanceof ProviderError && err.status === 400) {
      delete body.response_format;
      payload = await postJson(
        provider,
        `${cfg.baseUrl}/chat/completions`,
        body,
        { Authorization: `Bearer ${apiKey}`, ...extraHeaders },
        cfg.requestTimeoutMs,
      );
    } else {
      throw err;
    }
  }

  const res = payload as ChatResponse;
  if (res.error?.message) {
    throw new ProviderError(provider, "bad-output", res.error.message);
  }

  const choice = res.choices?.[0];
  const text = choice?.message?.content;
  if (!text) {
    throw new ProviderError(
      provider,
      "bad-output",
      `empty completion (finish_reason: ${choice?.finish_reason ?? "unknown"})`,
    );
  }
  if (choice?.finish_reason === "length") {
    // Truncated mid-object. json.ts can sometimes repair it, so don't fail
    // outright — but say so, because it explains a downstream schema error.
    throw new ProviderError(
      provider,
      "bad-output",
      "response hit the token limit before completing the JSON object",
    );
  }

  return { text, model: res.model ?? model.id };
}

/** Fetch a provider's live model list from the OpenAI-compatible endpoint. */
export async function listModels(
  provider: ProviderId,
  apiKey: string,
): Promise<Array<Record<string, unknown>>> {
  const cfg = PROVIDERS[provider];
  const payload = (await getJson(
    provider,
    `${cfg.baseUrl}/models`,
    { Authorization: `Bearer ${apiKey}` },
    cfg.requestTimeoutMs,
  )) as { data?: Array<Record<string, unknown>> };
  return payload.data ?? [];
}
