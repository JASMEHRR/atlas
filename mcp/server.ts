#!/usr/bin/env node
/**
 * Atlas MCP server (stdio).
 *
 * Reads the same SQLite file the web app writes, so anything ingested in the
 * UI is immediately resolvable from Claude Code with no export step. Three
 * tools, mirroring the REST API exactly: search_inspirations,
 * get_inspiration, compose_prompt.
 *
 * Run from the Atlas project root — the DB path is resolved from cwd.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { search, similar } from "../src/lib/search.ts";
import { getInspiration, recordUse, allSlugs } from "../src/lib/repo.ts";
import { compose } from "../src/lib/compose.ts";
import { isConfigured } from "../src/lib/ai/index.ts";
import { SearchQuery, Facets, MixRole, OutputMode } from "../src/lib/schema.ts";

const server = new McpServer({ name: "atlas", version: "1.0.0" });

const text = (body: string) => ({ content: [{ type: "text" as const, text: body }] });

server.registerTool(
  "search_inspirations",
  {
    title: "Search the Atlas design library",
    description:
      "Find design references by natural language, style, mood, component, or " +
      "colour. Returns slugs plus a one-line design DNA for each. Use this " +
      "when you need a reference and do not already know its slug.",
    inputSchema: {
      query: z
        .string()
        .default("")
        .describe(
          'Natural language, e.g. "minimal glass dashboard" or "warm editorial with heavy type". Empty lists everything.',
        ),
      style_family: z.string().optional().describe("Filter by style family."),
      component: z
        .string()
        .optional()
        .describe("Only entries demonstrating this component, e.g. 'pricing-table'."),
      verified_only: z.boolean().default(false),
      limit: z.number().int().min(1).max(50).default(12),
    },
  },
  async (args) => {
    const facets = Facets.parse({
      family: args.style_family ? [args.style_family] : [],
      components: args.component ? [args.component] : [],
      verifiedOnly: args.verified_only,
    });
    const hits = await search(
      SearchQuery.parse({
        q: args.query,
        facets,
        limit: args.limit,
        // Query expansion needs a provider; harmless no-op without one.
        expand: Boolean(args.query) && isConfigured(),
      }),
    );

    if (hits.length === 0) {
      return text(
        `No matches for "${args.query}".\n\nThe library currently holds: ${
          allSlugs().join(", ") || "(nothing yet)"
        }`,
      );
    }

    return text(
      hits
        .map(
          (h) =>
            `- \`${h.slug}\` — ${h.dna} (${h.family}${h.humanVerified ? ", human-verified" : ""})\n  ${h.whyItWorks}\n  matched on: ${h.matchedOn.join(", ")}`,
        )
        .join("\n\n"),
    );
  },
);

server.registerTool(
  "get_inspiration",
  {
    title: "Get a design reference by slug",
    description:
      "Return the full, ready-to-use implementation prompt for one design " +
      "reference. Use this once you know the slug. The 'prompt' section is a " +
      "complete content-agnostic instruction — follow it directly.",
    inputSchema: {
      slug: z.string().describe("The reference's stable slug, e.g. 'apple-glass-nav'."),
      section: z
        .enum(["prompt", "brief", "tokens", "all"])
        .default("prompt")
        .describe("Which artifact to return. 'prompt' is usually what you want."),
    },
  },
  async (args) => {
    const i = getInspiration(args.slug);
    if (!i) {
      return text(
        `No reference called "${args.slug}".\n\nAvailable: ${allSlugs().join(", ") || "(library is empty)"}`,
      );
    }
    recordUse(args.slug);

    const header = `# ${i.analysis.identity.name} (\`${i.slug}\`)\n${i.analysis.identity.dna}\n${
      i.humanVerified ? "Human-verified.\n" : `Analysis quality ${i.qualityScore} — unverified.\n`
    }`;

    const body =
      args.section === "brief"
        ? i.artifacts.brief
        : args.section === "tokens"
          ? i.artifacts.tokenSet
          : args.section === "all"
            ? `${i.artifacts.claudePrompt}\n\n---\n\n${i.artifacts.tokenSet}\n\n---\n\n${i.artifacts.brief}`
            : i.artifacts.claudePrompt;

    const related = similar(args.slug, 3);
    const footer = related.length
      ? `\n\n---\nRelated: ${related.map((r) => `\`${r.slug}\` (${r.dna})`).join(", ")}`
      : "";

    return text(`${header}\n${body}${footer}`);
  },
);

server.registerTool(
  "compose_prompt",
  {
    title: "Compose one prompt from several references",
    description:
      "Combine several design references, each assigned a role (navigation, " +
      "hero, typography, colour, layout, motion, surface, component, voice), " +
      "into a single coherent build instruction. Conflicts between the " +
      "references are detected and resolved explicitly. Use this instead of " +
      "calling get_inspiration several times and merging the results yourself.",
    inputSchema: {
      picks: z
        .array(
          z.object({
            slug: z.string(),
            role: MixRole,
            detail: z.string().default("").describe("Optional narrowing, e.g. a component name."),
          }),
        )
        .min(1)
        .max(12),
      mode: OutputMode.default("full-page"),
      intent: z
        .string()
        .default("")
        .describe("What is actually being built, so the prompt is written against it."),
    },
  },
  async (args) => {
    try {
      const result = compose({
        picks: args.picks,
        mode: args.mode,
        intent: args.intent,
      });
      const blocking = result.conflicts.filter((c) => c.severity === "incompatible");
      const warning = blocking.length
        ? `\n\n> NOTE: ${blocking.length} genuine incompatibilit${blocking.length === 1 ? "y was" : "ies were"} found between these references. The resolutions are already applied in the prompt above; raise them with the user if you disagree.`
        : "";
      return text(result.prompt + warning);
    } catch (err) {
      return text(
        `Could not compose: ${err instanceof Error ? err.message : String(err)}\n\nAvailable slugs: ${allSlugs().join(", ")}`,
      );
    }
  },
);

await server.connect(new StdioServerTransport());
