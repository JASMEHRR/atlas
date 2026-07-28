"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { SearchHit } from "@/lib/schema";
import { Chip, CopyButton, MonoPanel, toast } from "./primitives";

type Collection = { name: string; count: number };

export function Collections() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [members, setMembers] = useState<SearchHit[]>([]);
  const [houseStyle, setHouseStyle] = useState("");
  const [all, setAll] = useState<SearchHit[]>([]);
  const [newName, setNewName] = useState("");

  const loadCollections = useCallback(async () => {
    const res = await fetch("/api/collections");
    setCollections((await res.json()).collections ?? []);
  }, []);

  const loadAll = useCallback(async () => {
    const res = await fetch("/api/search");
    setAll((await res.json()).hits ?? []);
  }, []);

  useEffect(() => {
    void loadCollections();
    void loadAll();
  }, [loadCollections, loadAll]);

  const open = useCallback(
    async (name: string) => {
      setActive(name);
      const res = await fetch(`/api/collections?name=${encodeURIComponent(name)}`);
      const data = await res.json();
      setHouseStyle(data.houseStyle ?? "");
      const slugs: string[] = data.slugs ?? [];
      setMembers(all.filter((h) => slugs.includes(h.slug)));
    },
    [all],
  );

  const setMembership = async (slug: string, add: boolean) => {
    if (!active) return;
    await fetch("/api/collections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: active, slug, action: add ? "add" : "remove" }),
    });
    await loadCollections();
    await open(active);
  };

  const create = async () => {
    const name = newName.trim();
    if (!name || all.length === 0) return;
    // A collection needs at least one member to exist; seed with the first
    // entry so the row is never a dangling empty name.
    await fetch("/api/collections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, slug: all[0]!.slug }),
    });
    setNewName("");
    await loadCollections();
    await open(name);
    toast(`Created "${name}"`);
  };

  return (
    <div className="mx-auto max-w-[1600px] px-5 py-6">
      <header className="flex flex-wrap items-baseline gap-4">
        <h1 className="display text-2xl">Collections</h1>
        <p className="max-w-2xl text-sm text-ink-muted">
          Group references per project. Each collection gets a composed{" "}
          <em>house style</em> — the language its members actually agree on.
        </p>
      </header>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {collections.map((c) => (
          <Chip
            key={c.name}
            active={active === c.name}
            count={c.count}
            onClick={() => void open(c.name)}
          >
            {c.name}
          </Chip>
        ))}
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New collection"
            aria-label="New collection name"
            className="w-44 border border-rule bg-transparent px-3 py-1.5 text-sm outline-none placeholder:text-ink-faint"
          />
          <button
            type="submit"
            disabled={!newName.trim() || all.length === 0}
            className="chip hover:border-ink hover:text-ink disabled:opacity-50"
          >
            Create
          </button>
        </form>
      </div>

      {!active ? (
        <div className="mt-6 border border-rule bg-paper-raised px-8 py-14 text-center">
          <p className="display text-2xl">
            {collections.length ? "Pick a collection" : "No collections yet"}
          </p>
          <p className="mx-auto mt-3 max-w-lg text-sm text-ink-muted">
            A collection is usually one project&apos;s worth of references. Its
            house style is what you paste when you want everything in that
            project to feel like one thing.
          </p>
        </div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div>
            <p className="label mb-2 text-ink-faint">
              In &ldquo;{active}&rdquo; — {members.length}
            </p>
            <ul className="border border-rule">
              {members.map((h) => (
                <li
                  key={h.slug}
                  className="flex items-center gap-3 border-b border-rule px-3 py-2 last:border-b-0"
                >
                  <img
                    src={h.thumbPath}
                    alt=""
                    width={64}
                    height={48}
                    loading="lazy"
                    className="h-12 w-16 border border-rule object-cover object-top"
                  />
                  <Link href={`/i/${h.slug}`} className="min-w-0 flex-1">
                    <span className="display block truncate text-base">{h.name}</span>
                    <span className="block truncate font-mono text-2xs text-ink-faint">
                      {h.dna}
                    </span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => void setMembership(h.slug, false)}
                    className="chip hover:border-bad hover:text-bad"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>

            <p className="label mt-5 mb-2 text-ink-faint">Add to this collection</p>
            <div className="flex flex-wrap gap-2">
              {all
                .filter((h) => !members.some((m) => m.slug === h.slug))
                .map((h) => (
                  <Chip key={h.slug} onClick={() => void setMembership(h.slug, true)}>
                    + {h.slug}
                  </Chip>
                ))}
            </div>
          </div>

          <div>
            <p className="label mb-2 text-ink-faint">House style</p>
            <MonoPanel body={houseStyle} maxHeight="60vh" highlight={false} />
            <div className="mt-3">
              <CopyButton text={houseStyle} label="Copy house style" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
