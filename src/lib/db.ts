/**
 * node:sqlite — verified to ship FTS5 + bm25() on Node 24. Chosen over
 * better-sqlite3 so `npm install` never needs a C++ toolchain on Windows.
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";

// Overridable so the test suite runs against a throwaway directory instead
// of the real library.
export const DATA_DIR =
  process.env.ATLAS_DATA_DIR ?? path.join(process.cwd(), "data");
export const IMAGES_DIR = path.join(DATA_DIR, "images");
const DB_PATH = path.join(DATA_DIR, "atlas.db");

let handle: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (handle) return handle;
  mkdirSync(IMAGES_DIR, { recursive: true });
  const conn = new DatabaseSync(DB_PATH);
  const ddl = readFileSync(
    path.join(process.cwd(), "src", "lib", "schema.sql"),
    "utf8",
  );
  conn.exec(ddl);
  handle = conn;
  return conn;
}

/** Rows come back as null-prototype objects; normalise for Zod and spreads. */
export function rows<T = Record<string, unknown>>(
  sql: string,
  ...params: Array<string | number | null>
): T[] {
  return db()
    .prepare(sql)
    .all(...params)
    .map((r) => ({ ...r })) as T[];
}

export function row<T = Record<string, unknown>>(
  sql: string,
  ...params: Array<string | number | null>
): T | null {
  return rows<T>(sql, ...params)[0] ?? null;
}

export function run(
  sql: string,
  ...params: Array<string | number | null>
): void {
  db()
    .prepare(sql)
    .run(...params);
}

/** Release the file handle. Windows refuses to delete an open SQLite file. */
export function closeDb(): void {
  handle?.close();
  handle = null;
}

/** node:sqlite has no transaction helper; this is the whole of it. */
export function tx<T>(fn: () => T): T {
  const conn = db();
  conn.exec("BEGIN");
  try {
    const out = fn();
    conn.exec("COMMIT");
    return out;
  } catch (err) {
    conn.exec("ROLLBACK");
    throw err;
  }
}

export const now = () => new Date().toISOString();
