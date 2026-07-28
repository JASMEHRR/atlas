# Atlas

Turns UI screenshots into a machine-reusable design knowledge base that Claude
Code can build from.

The unit of value is not the image — it is the **structured design brief**
extracted from it. The image is the citation. Every entry gets a stable
kebab-case slug, and that slug is the whole interface between you and Claude
Code:

> build the pricing page using the nav from `apple-glass-nav`, the section
> rhythm from `linear-hero`, and the motion from `arc-onboarding`

Claude Code resolves that without ever seeing the screenshots.

---

## Setup

```bash
npm install
cp .env.example .env      # add at least one provider key — see below
npm run dev               # http://localhost:3000
```

Everything lives in `./data/` — one SQLite file and the images. No cloud
database, no auth, no Docker, no build step beyond `next dev`.

### AI providers — automatic, no Anthropic or OpenAI key ever

Atlas never calls Anthropic or OpenAI and never asks for a key from either.
It supports exactly three providers, tried in this order, with automatic
failover and zero manual intervention:

| Priority | Provider | Env var | Why |
|---|---|---|---|
| 1 (primary) | [Groq](https://console.groq.com/keys) | `GROQ_API_KEY` | Fastest inference; best available Qwen vision model preferred |
| 2 (secondary) | [OpenRouter](https://openrouter.ai/keys) | `OPENROUTER_API_KEY` | Used only if Groq is down, rate-limited, or lacks a model. **Free models only** — see below |
| 3 (backup) | [Gemini](https://aistudio.google.com/apikey) | `GEMINI_API_KEY` | Used only if both above fail. Free-tier model families only |

Add just one key and Atlas works. Add more and it fails over automatically —
you never pick a provider, and nothing in the app besides `src/lib/ai/` knows
which one answered a given request.

**The free-tier guarantee on OpenRouter is structural, not a suggestion.**
The live catalogue is filtered to zero-cost models *before* anything is
ranked, the request also carries a server-side `max_price: 0` ceiling, and if
no free model can do the job Atlas tells you and moves on to Gemini — it will
never spend your money without being told to. Check the **Export** page for
live status: which provider is next in line, which model each one would pick,
and any notices (like "OpenRouter has no free vision model right now").

To pin one exact model instead of automatic selection:

```bash
ATLAS_VISION_MODEL=groq:qwen/qwen3-vl-32b-instruct
ATLAS_TEXT_MODEL=groq:llama-3.1-8b-instant
```

Optional, only if you want to capture a URL rather than drop a screenshot:

```bash
npm run atlas:browser     # installs Playwright's Chromium
```

### Seeding

Drop screenshots into `./seed-screenshots/` and run:

```bash
npm run seed
# or: npm run seed -- ./one.png ./two.png
```

This runs the **real** pipeline — same stages, same validation, same failure
handling as the web app.

---

## Using it from Claude Code

Three routes in, in the order you should try them.

### 1. Export a skill (no configuration at all)

Export → *Export skill* → give it a project folder. Atlas writes:

```
<your project>/.claude/skills/design-library/
  SKILL.md                       how to resolve a slug, and the rules
  atlas.md                       compact table of every slug + design DNA
  inspirations/<slug>.md         one file per reference
  collections/<name>.md          per-collection house style
```

From then on `use apple-glass-nav` resolves by reading local files. Nothing
running, nothing configured, no network.

### 2. Local MCP server (live, no re-export)

```bash
claude mcp add atlas -- node --experimental-strip-types mcp/server.ts
```

or in `.mcp.json`:

```json
{
  "mcpServers": {
    "atlas": {
      "command": "node",
      "args": ["--experimental-strip-types", "mcp/server.ts"],
      "cwd": "<absolute path to this folder>"
    }
  }
}
```

Exposes `search_inspirations`, `get_inspiration(slug)` and
`compose_prompt(slugs, roles)`. It reads the same SQLite file the web app
writes, so anything you ingest is immediately resolvable.

### 3. REST API

`GET /api/v1` describes itself. The same three operations:

```
GET  /api/v1/search?q=minimal+glass+dashboard&limit=5
GET  /api/v1/inspirations/{slug}?section=prompt|brief|tokens|all
POST /api/v1/compose   { "picks": [{ "slug": "...", "role": "color" }] }
```

---

## What it does

**Ingest** — drop a screenshot anywhere on the page, paste from the clipboard,
or give a URL. Each capture becomes a job with five visible stages (ingest →
vision → derive → index → review). A failed stage shows its error text and
retries from where it stopped, not from the beginning.

**Analyse** — one structured vision call per screenshot, validated against a
Zod schema, answered by whichever of Groq / OpenRouter / Gemini is available
(see above). The palette is extracted programmatically first (k-means over the
actual pixels) and fed into the prompt, so the model reasons about real hex
values rather than an impression of them.

**Edit** — anything you correct is sticky. Human edits live in a separate table
and are applied *after* the AI analysis on every read, so they outrank it
permanently — including after a re-analysis with an improved prompt.

**Search** — `⌘K` for natural language, faceted filters for everything else,
including a swatch picker that matches colours perceptually rather than by hex.

**Mixboard** — assign each reference a role (navigation, hero, typography,
colour, layout, motion, surface, component, voice) and Atlas composes one
coherent prompt. It does not concatenate briefs: each pick contributes only its
assigned role, conflicts across picks are detected, and every conflict is
resolved explicitly with the resolution stated.

---

## Decisions, and why

**A provider abstraction with a hard boundary at `src/lib/ai/`.** Every other
file in the app calls `askJson({ system, prompt, schema, image? })` and gets
back typed data plus which provider/model answered — for display only, never
for branching on. Swapping a model, reordering priority, or adding a fourth
provider is a change to `src/lib/ai/config.ts` alone.

**Model IDs are patterns matched against a live catalogue, not hard-coded
strings.** Groq's and OpenRouter's hosted catalogues change constantly; a
pinned model ID silently 404s the day it's retired. `rankByPreference` ranks
whatever the provider serves *today* against an ordered preference list, so a
newer Qwen-VL release is picked up with no code change. Verified against
OpenRouter's real catalogue during development — and it caught a real bug:
"accepts image input" also matches safety classifiers, OCR endpoints, and
music-generation models, none of which can write a design brief. Excluded by
`NOT_A_GENERAL_VLM` before ranking, not left to the ranker to sort out.

**OpenRouter's free-tier rule is enforced structurally, not by convention.**
The catalogue is filtered to zero-cost models *before* ranking (a model with
no price data is treated as paid, not free — failing open here would be the
expensive kind of bug), the request also carries a server-side `max_price: 0`
ceiling as a second guarantee, and if nothing free can serve the request Atlas
raises `no-free-model`, which surfaces as a notice on the Export page and
fails over to Gemini. It never silently reaches for a paid model.

**Failover is per-request and automatic, with one in-place repair per
provider.** A provider is passed over for anything another provider could
plausibly fix: no key, no matching model, rate limit, timeout, 5xx, or output
that doesn't parse as the requested schema. A schema violation gets one retry
on the *same* provider with the actual validation error appended to the prompt
before the chain moves on — cheaper than burning the whole priority order over
a model that just needs to be told what it got wrong.

**JSON is coerced defensively, not trusted.** Open-weight models are good at
JSON but not uniform about code fences, leading prose, or truncation at the
token limit. `extractJson` finds the first balanced `{…}` object respecting
string escapes (so a `}` inside a description doesn't truncate the object) and
repairs an unbalanced-but-recoverable truncation before Zod validates it.
Anything that still fails is `bad-output`, which triggers failover rather than
writing a malformed record.

**`node:sqlite`, not better-sqlite3 or Drizzle.** Verified that Node 24's
built-in SQLite ships FTS5 and `bm25()`. Zero native compilation, which is the
usual way a "just run `npm install`" promise breaks on Windows.

**No embeddings.** None of Groq, OpenRouter, or Gemini exposes a free
embeddings endpoint worth depending on, and bundling a local model means a
~100 MB download inside a zero-config promise. Instead: FTS5/BM25 over a
model-authored `searchText` blob written specifically for retrieval at ingest
time, plus lexical signals, plus an optional cheap text call that expands a
natural-language query into terms that actually occur in the corpus.
Similar-inspirations uses tag Jaccard and CIEDE2000 palette distance. **This is
a real tradeoff:** it handles "warm editorial with heavy type" well because
that vocabulary is in the prose, and it would handle a genuinely oblique
paraphrase worse than embeddings would.

**One structured vision call, not several.** Cheaper, and it keeps the analysis
internally consistent — a model reasoning about typography and colour in one
pass produces a coherent brief rather than several disagreeing ones.

**Artifacts are derived deterministically, not generated.** The brief, prompt
and token set are pure functions of the analysis. That means an edit regenerates
them instantly and for free, and they can never drift from the stored data.

**k-means seeded deterministically.** The same image always yields the same
palette. Dedupe and the tests both depend on it.

**CIEDE2000, not CIE76.** CIE76 misreads near-neutrals badly, and this app
compares warm greys constantly. Note that CIEDE2000 compresses at the top of its
range — opposite hues score ~45, not ~100 — and the thresholds in
`compose.ts` and `search.ts` are calibrated to that, not to a linear intuition.

**`content-visibility: auto` instead of a virtualization library.** A native CSS
feature holds 60fps past 500 cards, works with the masonry view (which a
windowing library would fight), and with `contain-intrinsic-size` set to the
real card size it introduces no layout shift.

**Analyses are versioned and immutable; overrides are separate.** Re-analysing
appends a version. Your edits are stored apart and reapplied on read, so
improving the extraction prompt never costs you your corrections.

**Tag vocabulary is normalised through a synonym map.** "Glassmorphism",
"glass morphism" and "frosted" all collapse to `glass`, and words that describe
every design ever shipped ("modern", "clean") are dropped. Without this the tag
list rots within about thirty entries.

**`.ts` import specifiers throughout.** So `node --experimental-strip-types`
resolves the same files the bundler does, and the MCP server can import the app's
own library code rather than duplicating it.

---

## From §10 of the brief

**Built:** collections with a composed house style · compare view with the
differences articulated in words · design-system extraction across a collection
(this is what the house style is) · gap analysis · batch upload · provenance ·
version history on analyses · notes · usage tracking · full export/import
bundle · quality score.

**Cut, deliberately:**

- *Auto-grouping a batch upload into one multi-page entry.* Plain batch upload
  ships. Auto-grouping means guessing which screenshots belong to one site, and
  a collection already expresses that explicitly and correctly.
- *Cross-collection design-system extraction as a separate feature.* Folded into
  the collection house style, which is the same computation with a clearer home.

---

## Tests

```bash
npm test
```

85 tests over the things that would actually break: schema acceptance and
rejection, override precedence, tag normalisation, k-means determinism and role
assignment, ΔE and contrast maths, dedupe hashing, search ranking against a
fixed corpus, facet filtering, and prompt composition — including that each pick
contributes only its assigned role, that clashing picks are escalated correctly,
and that near-identical picks do not manufacture a conflict.

The AI layer gets its own suite (`tests/ai.test.ts`, `tests/failover.test.ts`)
with the network stubbed: provider priority order, that Qwen VL is preferred on
Groq and falls back gracefully when absent, that a paid OpenRouter model is
never selected under any circumstance, that safety/OCR/music models that merely
*accept* an image are excluded from vision selection, JSON coercion against
fenced/prose-wrapped/truncated output, and the full failover chain end to end —
rate limit → next provider, outage → next provider, bad output → repair then
next provider, no free model → notice + next provider, all-fail → an error
naming every provider and why.

---

## Keyboard

`⌘K` command palette · `/` focus search · `j`/`k` move · `Enter` open ·
`c` copy the focused entry's prompt · `x` add to Mixboard · `g` then
`l`/`m`/`c`/`e` to navigate · `?` shortcuts · `Esc` closes anything.

---

## Notes

- Font names are inferred from screenshots and are labelled `identified`,
  `likely` or `guess`. The prompt forbids asserting a font as fact; every
  candidate carries a real fallback stack.
- Analyses extract *transferable design language* — the system, the
  relationships, the principles — never a pixel-copy. Every entry also carries
  an anti-patterns section describing what breaks if the language is misapplied.
- `ATLAS_VISION_MODEL` / `ATLAS_TEXT_MODEL` pin an exact model
  (`provider:model-id`); `ATLAS_DATA_DIR` overrides the data directory (the
  test suite uses it).
