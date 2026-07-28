export const dynamic = "force-dynamic";

/** Self-describing root, so the API is usable without reading the README. */
export async function GET() {
  return Response.json({
    name: "Atlas",
    version: 1,
    description:
      "Design knowledge base. These three operations mirror the MCP tools exactly.",
    operations: {
      search_inspirations: {
        method: "GET",
        path: "/api/v1/search?q=...&family=...&component=...&verified=true&limit=12",
        returns: "{ hits: SearchHit[] }",
      },
      get_inspiration: {
        method: "GET",
        path: "/api/v1/inspirations/{slug}?section=prompt|brief|tokens|all",
        returns: "{ slug, name, dna, section, content, related }",
      },
      compose_prompt: {
        method: "POST",
        path: "/api/v1/compose",
        body: '{ picks: [{ slug, role, detail? }], mode?: "full-page"|"component"|"restyle", intent?: string }',
        returns: "{ prompt, conflicts, picks, mode }",
      },
    },
  });
}
