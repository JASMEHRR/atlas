/**
 * Getting reliable JSON out of open-weight models.
 *
 * A dedicated structured-output API guarantees the shape. Groq's and
 * OpenRouter's JSON modes are good but not uniform across every model in the
 * catalogue, and Gemini's response schema has its own dialect. So we ask
 * firmly, then parse defensively: strip fences and prose, balance truncated
 * braces, and validate with Zod. Anything that still fails is reported as
 * `bad-output`, which triggers failover rather than corrupting the library.
 */
import type { z } from "zod";

/** Pull the first complete JSON object out of a model response. */
export function extractJson(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;

  // ```json … ``` fences are the single most common wrapper.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced?.[1]?.trim() ?? text;

  const start = body.indexOf("{");
  if (start === -1) return null;

  // Scan for the matching close brace, respecting strings and escapes, so a
  // `}` inside a description doesn't truncate the object.
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }

  // Unbalanced: the response was cut off. Close what's open — often enough to
  // recover a usable object when only trailing optional fields were lost.
  if (depth > 0) {
    let repaired = body.slice(start);
    if (inString) repaired += '"';
    repaired = repaired.replace(/,\s*$/, "");
    return repaired + "}".repeat(depth);
  }
  return null;
}

export type ParseOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export function parseWithSchema<T>(
  raw: string,
  schema: z.ZodType<T>,
): ParseOutcome<T> {
  const json = extractJson(raw);
  if (!json) {
    return { ok: false, error: "no JSON object found in the response" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return {
      ok: false,
      error: `malformed JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const result = schema.safeParse(parsed);
  if (result.success) return { ok: true, data: result.data };

  return {
    ok: false,
    error: result.error.issues
      .slice(0, 6)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; "),
  };
}

/**
 * Schema instructions appended to the system prompt. Belt and braces: the
 * request also sets the provider's native JSON mode, but a model that ignores
 * it usually still obeys a clear in-prompt contract.
 */
export function schemaInstruction(
  schemaName: string,
  jsonSchema: Record<string, unknown>,
): string {
  return `## Output format — this is not optional

Reply with a single JSON object matching the "${schemaName}" schema below.
No prose before or after it. No markdown code fences. No commentary.
Every required property must be present. Do not add properties that are not
in the schema. Strings must be plain JSON strings.

${JSON.stringify(jsonSchema, null, 1)}`;
}

/** Feedback for a retry after a schema violation — name the actual failure. */
export function repairInstruction(error: string): string {
  return `Your previous reply did not satisfy the schema:

${error}

Reply again with the corrected JSON object only. Fix exactly those problems
and change nothing else.`;
}
