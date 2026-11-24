/**
 * Print what each provider actually serves today, and what Atlas would pick.
 *
 * Run when selection fails ("no model matched the configured preferences"):
 * the full catalogue tells you which pattern to add in src/lib/ai/config.ts.
 *
 *   npm run debug:providers
 *   npm run debug:providers -- --all     # don't truncate catalogues
 */
import { PROVIDER_ORDER, PROVIDERS, NOT_A_GENERAL_VLM } from "../src/lib/ai/config.ts";
import { gemini } from "../src/lib/ai/gemini.ts";
import { groq } from "../src/lib/ai/groq.ts";
import { openrouter } from "../src/lib/ai/openrouter.ts";
import { listModels } from "../src/lib/ai/openai-compatible.ts";
import { getJson } from "../src/lib/ai/http.ts";
import type { Capability, ProviderAdapter, ProviderId } from "../src/lib/ai/types.ts";

const SHOW_ALL = process.argv.includes("--all");
const adapters: Record<string, ProviderAdapter> = { groq, openrouter, gemini };

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

/** Raw catalogue per provider, so you can see what the patterns are matching against. */
async function rawCatalogue(id: string): Promise<string[]> {
  if (id === "gemini") {
    const url = `${PROVIDERS.gemini.baseUrl}/models?key=${encodeURIComponent(
      process.env.GEMINI_API_KEY ?? "",
    )}`;
    const payload = (await getJson("gemini", url, {}, 30_000)) as {
      models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
    };
    return (payload.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => String(m.name ?? ""));
  }
  const models = await listModels(
    id as "groq" | "openrouter",
    (id === "groq" ? process.env.GROQ_API_KEY : process.env.OPENROUTER_API_KEY) ?? "",
  );
  return models.map((m) => String((m as { id?: string }).id ?? "")).filter(Boolean);
}

async function report(id: ProviderId): Promise<void> {
  const adapter = adapters[id]!;
  const priority = PROVIDER_ORDER.indexOf(id) + 1;

  console.log(`\n${bold(`${priority}. ${id}`)}`);

  if (!adapter.isConfigured()) {
    console.log(`   ${dim(`not configured — set ${PROVIDERS[id].envKey}`)}`);
    return;
  }

  let catalogue: string[] = [];
  try {
    catalogue = await rawCatalogue(id);
    console.log(`   catalogue: ${green(String(catalogue.length))} models`);
  } catch (err) {
    console.log(`   catalogue: ${red(err instanceof Error ? err.message : String(err))}`);
    return;
  }

  for (const capability of ["vision", "text"] as Capability[]) {
    try {
      const picks = await adapter.selectModels(capability, 4);
      console.log(`   ${capability}:`);
      picks.forEach((p, i) => {
        const marker = i === 0 ? green("→") : dim(" ");
        console.log(`     ${marker} ${p.id} ${dim(`(${p.reason})`)}`);
      });
    } catch (err) {
      console.log(
        `   ${capability}: ${red(err instanceof Error ? err.message : String(err))}`,
      );
    }
  }

  const shown = SHOW_ALL ? catalogue : catalogue.slice(0, 30);
  console.log(dim(`   ── full catalogue${SHOW_ALL ? "" : ` (first ${shown.length})`} ──`));
  for (const m of shown) {
    const excluded = NOT_A_GENERAL_VLM.test(m);
    console.log(`     ${excluded ? yellow("✗") : " "} ${dim(m)}`);
  }
  if (!SHOW_ALL && catalogue.length > shown.length) {
    console.log(dim(`     … ${catalogue.length - shown.length} more (--all to show)`));
  }
  console.log(dim(`   ${yellow("✗")} = excluded from vision by NOT_A_GENERAL_VLM`));
}

console.log(bold("\nAtlas — AI provider diagnostics"));
console.log(dim("Priority order: " + PROVIDER_ORDER.join(" → ")));

for (const id of PROVIDER_ORDER) {
  await report(id);
}

console.log(
  dim(
    "\nNo vision model matched? Copy the real id from the catalogue above and add a\n" +
      "pattern to PROVIDERS.<provider>.models.vision in src/lib/ai/config.ts, or pin\n" +
      'one directly:  ATLAS_VISION_MODEL="groq:<exact-model-id>"\n',
  ),
);
