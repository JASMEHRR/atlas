"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CopyButton, MonoPanel, toast } from "./primitives";

type Gaps = {
  gaps: Array<{ gap: string; detail: string }>;
  mostUsed: Array<{ slug: string; use_count: number }>;
  total: number;
};

type Probe = { model: string; reason: string } | { error: string } | null;

type AiStatus = {
  configured: boolean;
  providers: Array<{
    id: string;
    priority: number;
    configured: boolean;
    vision: Probe;
    text: Probe;
  }>;
  notices: Array<{ provider: string; kind: string; message: string }>;
};

const MCP_CONFIG = `{
  "mcpServers": {
    "atlas": {
      "command": "node",
      "args": ["--experimental-strip-types", "mcp/server.ts"],
      "cwd": "<ABSOLUTE PATH TO YOUR ATLAS FOLDER>"
    }
  }
}`;

const hasError = (p: Probe): boolean => Boolean(p && "error" in p);

export function ExportPanel() {
  const [targetDir, setTargetDir] = useState("");
  const [result, setResult] = useState<{ root: string; count: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [gaps, setGaps] = useState<Gaps | null>(null);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/gaps");
      setGaps(await res.json());
    })();
    // Probes each provider's live catalogue, so it can take a moment.
    void (async () => {
      const res = await fetch("/api/ai/status");
      setAi(await res.json());
    })();
  }, []);

  const exportSkill = async () => {
    if (!targetDir.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/export/skill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetDir: targetDir.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setResult(json);
      toast(`Wrote ${json.count} files`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Export failed", "bad");
    } finally {
      setBusy(false);
    }
  };

  const importBundle = async (file: File) => {
    setBusy(true);
    try {
      const res = await fetch("/api/export/bundle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: await file.text(),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast(
        `Imported ${json.imported}${json.skipped.length ? `, skipped ${json.skipped.length} already present` : ""}`,
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : "Import failed", "bad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-5 py-6">
      <h1 className="display text-2xl">Export &amp; wiring</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-muted">
        Three ways to reach this library from Claude Code. The skill export is
        the one to start with — it needs no configuration at all.
      </p>

      <section className="mt-6 border border-rule">
        <h2 className="label border-b border-rule px-4 py-2.5 text-ink">
          AI providers — automatic, in priority order
        </h2>
        <div className="px-4 py-4">
          {!ai ? (
            <div className="anim-shimmer h-20 bg-paper-sunken" />
          ) : !ai.configured ? (
            <p className="text-sm text-warn">
              No provider configured. Add at least one key to{" "}
              <span className="font-mono">.env</span> —{" "}
              <span className="font-mono text-accent">GROQ_API_KEY</span>,{" "}
              <span className="font-mono text-accent">OPENROUTER_API_KEY</span>{" "}
              or <span className="font-mono text-accent">GEMINI_API_KEY</span>.
              Atlas never needs an Anthropic or OpenAI key.
            </p>
          ) : (
            <ul className="space-y-2">
              {ai.providers.map((p) => (
                <li key={p.id} className="border border-rule px-3 py-2.5">
                  <div className="flex items-baseline gap-3">
                    <span className="label text-ink-faint">{p.priority}</span>
                    <span className="display text-base">{p.id}</span>
                    <span
                      className={`label ml-auto ${
                        !p.configured
                          ? "text-ink-faint"
                          : hasError(p.vision)
                            ? "text-warn"
                            : "text-ok"
                      }`}
                    >
                      {!p.configured
                        ? "no key — skipped"
                        : hasError(p.vision)
                          ? "unavailable"
                          : "ready"}
                    </span>
                  </div>
                  {p.configured && (
                    <dl className="mt-1.5 space-y-0.5">
                      {(
                        [
                          ["vision", p.vision],
                          ["text", p.text],
                        ] as const
                      ).map(([role, probe]) => (
                        <div key={role} className="flex gap-3 font-mono text-2xs">
                          <dt className="w-12 shrink-0 text-ink-faint">{role}</dt>
                          <dd
                            className={
                              probe && "error" in probe
                                ? "text-warn"
                                : "text-ink-muted"
                            }
                          >
                            {probe && "error" in probe
                              ? probe.error
                              : probe
                                ? `${probe.model} — ${probe.reason}`
                                : "—"}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </li>
              ))}
            </ul>
          )}

          {ai?.notices.length ? (
            <div className="mt-3 space-y-2">
              {ai.notices.map((n, i) => (
                <p
                  key={i}
                  role="alert"
                  className="border-l-2 border-warn bg-warn/5 py-2 pl-3 text-sm text-ink"
                >
                  <span className="label text-warn">{n.provider}</span>{" "}
                  {n.message}
                </p>
              ))}
            </div>
          ) : null}

          <p className="mt-3 text-2xs text-ink-faint">
            Failover is automatic — the first provider that can serve a request
            wins. OpenRouter is restricted to free models; if none can do the
            job you are told rather than charged.
          </p>
        </div>
      </section>

      <section className="mt-4 border border-rule">
        <h2 className="label border-b border-rule px-4 py-2.5 text-ink">
          1 · Export as a Claude Code skill
        </h2>
        <div className="px-4 py-4">
          <p className="text-sm text-ink-muted">
            Writes <span className="font-mono text-accent">.claude/skills/design-library/</span>{" "}
            into a project: a SKILL.md, an <span className="font-mono">atlas.md</span> index,
            and one markdown file per reference. After that,{" "}
            <span className="font-mono text-accent">use apple-glass-nav</span> resolves by
            reading local files — no server, no network.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={targetDir}
              onChange={(e) => setTargetDir(e.target.value)}
              placeholder="E:\imp\projects\my-app"
              aria-label="Target project folder"
              className="min-w-72 flex-1 border border-rule bg-transparent px-3 py-2 font-mono text-xs outline-none placeholder:text-ink-faint"
            />
            <button
              type="button"
              onClick={exportSkill}
              disabled={busy || !targetDir.trim()}
              className="chip border-ink hover:bg-ink hover:text-paper disabled:opacity-50"
            >
              Export skill
            </button>
          </div>
          {result && (
            <p className="mt-3 border border-ok/40 bg-ok/5 px-3 py-2 font-mono text-2xs text-ok">
              Wrote {result.count} files to {result.root}
            </p>
          )}
        </div>
      </section>

      <section className="mt-4 border border-rule">
        <h2 className="label border-b border-rule px-4 py-2.5 text-ink">
          2 · Local MCP server
        </h2>
        <div className="px-4 py-4">
          <p className="text-sm text-ink-muted">
            Live access to the same database — anything you ingest here is
            immediately resolvable, with no re-export. Exposes{" "}
            <span className="font-mono text-accent">search_inspirations</span>,{" "}
            <span className="font-mono text-accent">get_inspiration</span> and{" "}
            <span className="font-mono text-accent">compose_prompt</span>.
          </p>
          <p className="mt-2 text-sm text-ink-muted">
            Add this to <span className="font-mono">.mcp.json</span> in your project,
            or run{" "}
            <span className="font-mono text-accent">
              claude mcp add atlas -- node --experimental-strip-types mcp/server.ts
            </span>{" "}
            from the Atlas folder.
          </p>
          <div className="mt-3">
            <MonoPanel body={MCP_CONFIG} highlight={false} maxHeight="12rem" />
            <div className="mt-2">
              <CopyButton text={MCP_CONFIG} label="Copy MCP config" />
            </div>
          </div>
        </div>
      </section>

      <section className="mt-4 border border-rule">
        <h2 className="label border-b border-rule px-4 py-2.5 text-ink">
          3 · REST API
        </h2>
        <div className="px-4 py-4">
          <p className="text-sm text-ink-muted">
            The same three operations over HTTP, for anything that is not Claude
            Code. <Link href="/api/v1" className="text-accent hover:underline">
              GET /api/v1
            </Link>{" "}
            describes itself.
          </p>
          <div className="mt-3">
            <MonoPanel
              highlight={false}
              body={`GET  /api/v1/search?q=minimal+glass+dashboard&limit=5
GET  /api/v1/inspirations/{slug}?section=prompt
POST /api/v1/compose  { "picks": [{"slug":"...","role":"color"}] }`}
              maxHeight="8rem"
            />
          </div>
        </div>
      </section>

      <section className="mt-4 border border-rule">
        <h2 className="label border-b border-rule px-4 py-2.5 text-ink">
          Your data
        </h2>
        <div className="flex flex-wrap gap-2 px-4 py-4">
          <a
            href="/api/export/bundle"
            className="chip hover:border-ink hover:text-ink"
            download
          >
            Download full bundle (JSON + images)
          </a>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="chip hover:border-ink hover:text-ink disabled:opacity-50"
          >
            Import bundle
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importBundle(f);
              e.target.value = "";
            }}
          />
          <p className="w-full text-2xs text-ink-faint">
            Everything lives in <span className="font-mono">./data/</span> — the
            SQLite file and the images. The bundle is a single portable JSON
            file with the images inlined.
          </p>
        </div>
      </section>

      {gaps && (
        <section className="mt-4 border border-rule">
          <h2 className="label border-b border-rule px-4 py-2.5 text-ink">
            Library health — {gaps.total} entries
          </h2>
          <div className="px-4 py-4">
            {gaps.gaps.length === 0 ? (
              <p className="text-sm text-ink-muted">
                Nothing obviously skewed. Keep collecting.
              </p>
            ) : (
              <ul className="space-y-2">
                {gaps.gaps.map((g) => (
                  <li key={g.gap} className="border-l-2 border-warn pl-3">
                    <p className="text-sm text-ink">{g.gap}</p>
                    <p className="text-sm text-ink-muted">{g.detail}</p>
                  </li>
                ))}
              </ul>
            )}

            {gaps.mostUsed.length > 0 && (
              <>
                <p className="label mt-5 mb-2 text-ink-faint">Most referenced</p>
                <ul className="space-y-1">
                  {gaps.mostUsed.map((m) => (
                    <li key={m.slug} className="flex items-baseline gap-3 text-sm">
                      <Link
                        href={`/i/${m.slug}`}
                        className="font-mono text-xs text-accent hover:underline"
                      >
                        {m.slug}
                      </Link>
                      <span className="text-ink-faint">{m.use_count}×</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
