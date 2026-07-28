/**
 * The only file you edit to change providers or models.
 *
 * Model IDs are matched as PATTERNS against each provider's live catalogue,
 * not asserted as fixed strings. A hosted catalogue changes constantly; a
 * hard-coded ID silently 404s the day it is retired. Patterns are ranked in
 * order — the first pattern that matches something the provider actually
 * serves today wins, so a newer Qwen VL is picked up automatically the moment
 * it appears, with no code change.
 */
import type { Capability, ProviderId } from "./types.ts";

/** Failover order. First configured provider that can serve the request wins. */
export const PROVIDER_ORDER: ProviderId[] = ["groq", "openrouter", "gemini"];

export type ModelPreference = {
  /** Matched case-insensitively against the provider's model id. */
  pattern: RegExp;
  /** Human-readable, shown in diagnostics. */
  label: string;
};

type ProviderConfig = {
  /** Env var holding the key. Absent key = provider skipped, never an error. */
  envKey: string;
  baseUrl: string;
  /** Ranked, best first. */
  models: Record<Capability, ModelPreference[]>;
  /** Hard cap per request, guards against runaway spend/latency. */
  maxOutputTokens: number;
  requestTimeoutMs: number;
};

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  /* ---------------------------------------------------------------- */
  /* 1. Groq — primary. Chosen for latency; Qwen VL preferred.         */
  /* ---------------------------------------------------------------- */
  groq: {
    envKey: "GROQ_API_KEY",
    baseUrl: "https://api.groq.com/openai/v1",
    maxOutputTokens: 16000,
    requestTimeoutMs: 120_000,
    models: {
      // Qwen vision first, newest generation first, per requirement.
      vision: [
        { pattern: /qwen.*3.*vl.*(235b|72b)/i, label: "Qwen3-VL (large)" },
        { pattern: /qwen.*3.*vl/i, label: "Qwen3-VL" },
        { pattern: /qwen.*2\.5.*vl.*72b/i, label: "Qwen2.5-VL 72B" },
        { pattern: /qwen.*2\.5.*vl/i, label: "Qwen2.5-VL" },
        { pattern: /qwen.*vl/i, label: "Qwen VL (any)" },
        // Non-Qwen fallbacks so a Qwen outage doesn't cost us the provider.
        { pattern: /llama-4-maverick/i, label: "Llama 4 Maverick" },
        { pattern: /llama-4-scout/i, label: "Llama 4 Scout" },
        { pattern: /llava/i, label: "LLaVA" },
      ],
      // Fast, cheap, structured — used for query expansion.
      text: [
        { pattern: /llama-3\.1-8b-instant/i, label: "Llama 3.1 8B Instant" },
        { pattern: /llama-3\.3-70b-versatile/i, label: "Llama 3.3 70B" },
        { pattern: /qwen.*3.*32b/i, label: "Qwen3 32B" },
        { pattern: /gemma2?-9b/i, label: "Gemma 2 9B" },
        { pattern: /instant|8b|9b/i, label: "any small instruct model" },
      ],
    },
  },

  /* ---------------------------------------------------------------- */
  /* 2. OpenRouter — secondary. FREE MODELS ONLY (enforced in code).   */
  /* ---------------------------------------------------------------- */
  openrouter: {
    envKey: "OPENROUTER_API_KEY",
    baseUrl: "https://openrouter.ai/api/v1",
    maxOutputTokens: 16000,
    requestTimeoutMs: 180_000,
    models: {
      // Ranked by quality. The free-tier filter is applied FIRST and is not
      // negotiable — see openrouter.ts. These only order what survives it.
      vision: [
        { pattern: /qwen.*vl.*(235b|72b)/i, label: "Qwen VL (large)" },
        { pattern: /qwen.*3.*vl/i, label: "Qwen3-VL" },
        { pattern: /qwen.*vl/i, label: "Qwen VL" },
        { pattern: /llama-4-maverick/i, label: "Llama 4 Maverick" },
        { pattern: /llama-4-scout/i, label: "Llama 4 Scout" },
        { pattern: /gemini.*flash/i, label: "Gemini Flash" },
        { pattern: /gemma-\d+.*\d+b/i, label: "Gemma (multimodal)" },
        { pattern: /nemotron.*(vl|omni|reasoning)/i, label: "Nemotron multimodal" },
        { pattern: /internvl|llava|pixtral|moondream|molmo|idefics/i, label: "other VLM" },
      ],
      text: [
        { pattern: /qwen.*3.*(235b|32b)/i, label: "Qwen3 (large)" },
        { pattern: /deepseek.*(v3|r1)/i, label: "DeepSeek" },
        { pattern: /llama-3\.3-70b/i, label: "Llama 3.3 70B" },
        { pattern: /gemini.*flash/i, label: "Gemini Flash" },
        { pattern: /./, label: "any free text model" },
      ],
    },
  },

  /* ---------------------------------------------------------------- */
  /* 3. Gemini — last resort. Free-tier model families only.           */
  /* ---------------------------------------------------------------- */
  gemini: {
    envKey: "GEMINI_API_KEY",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    maxOutputTokens: 16000,
    requestTimeoutMs: 180_000,
    models: {
      vision: [
        { pattern: /gemini-2\.5-flash(?!.*lite)/i, label: "Gemini 2.5 Flash" },
        { pattern: /gemini-2\.0-flash(?!.*lite)/i, label: "Gemini 2.0 Flash" },
        { pattern: /gemini-2\.5-flash-lite/i, label: "Gemini 2.5 Flash Lite" },
        { pattern: /gemini-2\.0-flash-lite/i, label: "Gemini 2.0 Flash Lite" },
      ],
      text: [
        { pattern: /gemini-2\.0-flash-lite/i, label: "Gemini 2.0 Flash Lite" },
        { pattern: /gemini-2\.5-flash-lite/i, label: "Gemini 2.5 Flash Lite" },
        { pattern: /gemini-2\.0-flash(?!.*lite)/i, label: "Gemini 2.0 Flash" },
        { pattern: /gemini-2\.5-flash(?!.*lite)/i, label: "Gemini 2.5 Flash" },
      ],
    },
  },
};

/**
 * Gemini charges for Pro tiers and some preview models. Only families that
 * have a genuine free tier may be selected, regardless of the patterns above.
 */
export const GEMINI_FREE_TIER = /^models\/gemini-(2\.0|2\.5)-flash/i;

/**
 * Accepting an image is not the same as being able to describe a design.
 * Catalogues list safety classifiers, moderation guards, OCR-only models,
 * music/audio and image-generation endpoints as "image input" — all of which
 * would be selected by a naive largest-context fallback and all of which
 * produce garbage here. Excluded before any ranking happens.
 */
export const NOT_A_GENERAL_VLM =
  /content-safety|guard|moderation|shield|nsfw|\bocr\b|embed|rerank|whisper|tts|speech|audio|lyria|music|diffusion|image-?gen|imagen|flux|stable-?diffusion|sora|veo|upscal/i;

/** Catalogue cache lifetime. Long enough to be free, short enough to notice. */
export const CATALOGUE_TTL_MS = 10 * 60 * 1000;

/**
 * A pinned override, for when you want one exact model rather than automatic
 * selection: ATLAS_VISION_MODEL="groq:qwen/qwen3-vl-32b-instruct".
 * Format is `<provider>:<model id>`. Skips discovery for that capability.
 */
export function pinnedModel(
  capability: Capability,
): { provider: ProviderId; id: string } | null {
  const raw =
    capability === "vision"
      ? process.env.ATLAS_VISION_MODEL
      : process.env.ATLAS_TEXT_MODEL;
  if (!raw) return null;

  const idx = raw.indexOf(":");
  if (idx < 1) return null;
  const provider = raw.slice(0, idx).trim() as ProviderId;
  const id = raw.slice(idx + 1).trim();
  if (!(provider in PROVIDERS) || !id) return null;
  return { provider, id };
}

/** Rank a live catalogue against the preference list. Unmatched are dropped. */
export function rankByPreference(
  available: string[],
  preferences: ModelPreference[],
): Array<{ id: string; rank: number; label: string }> {
  const ranked: Array<{ id: string; rank: number; label: string }> = [];
  for (const id of available) {
    for (let i = 0; i < preferences.length; i++) {
      const pref = preferences[i]!;
      if (pref.pattern.test(id)) {
        ranked.push({ id, rank: i, label: pref.label });
        break;
      }
    }
  }
  // Ties broken by id so selection is stable across restarts.
  return ranked.sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
}
