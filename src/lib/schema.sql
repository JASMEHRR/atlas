-- Atlas storage. Applied on every boot; every statement is idempotent.
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS inspirations (
  slug            TEXT PRIMARY KEY,
  sha256          TEXT NOT NULL UNIQUE,
  image_path      TEXT NOT NULL,
  thumb_path      TEXT NOT NULL,
  width           INTEGER NOT NULL,
  height          INTEGER NOT NULL,
  provenance      TEXT NOT NULL,          -- Provenance JSON
  artifacts       TEXT NOT NULL,          -- Artifacts JSON (regenerated on edit)
  quality_score   REAL NOT NULL DEFAULT 0,
  human_verified  INTEGER NOT NULL DEFAULT 0,
  use_count       INTEGER NOT NULL DEFAULT 0,
  analysis_version INTEGER NOT NULL DEFAULT 1,
  notes           TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- Every analysis run is kept. Re-analyzing never destroys history.
CREATE TABLE IF NOT EXISTS analyses (
  slug       TEXT NOT NULL REFERENCES inspirations(slug) ON DELETE CASCADE,
  version    INTEGER NOT NULL,
  payload    TEXT NOT NULL,               -- Analysis JSON, raw model output
  model      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (slug, version)
);

-- Human edits. Applied last, so they permanently outrank AI text.
CREATE TABLE IF NOT EXISTS field_overrides (
  slug       TEXT NOT NULL REFERENCES inspirations(slug) ON DELETE CASCADE,
  field      TEXT NOT NULL,               -- OverridableField
  value      TEXT NOT NULL,               -- JSON-encoded replacement
  created_at TEXT NOT NULL,
  PRIMARY KEY (slug, field)
);

-- Denormalised for facet filtering; rebuilt from the effective analysis.
CREATE TABLE IF NOT EXISTS facets (
  slug       TEXT PRIMARY KEY REFERENCES inspirations(slug) ON DELETE CASCADE,
  family     TEXT NOT NULL,
  density    TEXT NOT NULL,
  motion     TEXT NOT NULL,
  difficulty TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
  slug TEXT NOT NULL REFERENCES inspirations(slug) ON DELETE CASCADE,
  tag  TEXT NOT NULL,                     -- already normalised
  kind TEXT NOT NULL,                     -- 'tag' | 'mood' | 'component' | 'treatment'
  PRIMARY KEY (slug, tag, kind)
);
CREATE INDEX IF NOT EXISTS tags_by_tag ON tags(tag);

CREATE TABLE IF NOT EXISTS palette (
  slug   TEXT NOT NULL REFERENCES inspirations(slug) ON DELETE CASCADE,
  hex    TEXT NOT NULL,
  role   TEXT NOT NULL,
  weight REAL NOT NULL,
  -- CIELAB, stored so colour-distance search is a plain SQL scan.
  l REAL NOT NULL, a REAL NOT NULL, b REAL NOT NULL,
  PRIMARY KEY (slug, hex, role)
);

CREATE TABLE IF NOT EXISTS components (
  slug  TEXT NOT NULL REFERENCES inspirations(slug) ON DELETE CASCADE,
  kind  TEXT NOT NULL,
  label TEXT NOT NULL,
  PRIMARY KEY (slug, kind, label)
);
CREATE INDEX IF NOT EXISTS components_by_kind ON components(kind);

CREATE VIRTUAL TABLE IF NOT EXISTS inspiration_fts USING fts5(
  slug UNINDEXED,
  name,
  dna,
  why,
  tags,
  prose,
  tokenize = 'porter unicode61'
);

CREATE TABLE IF NOT EXISTS collections (
  name       TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS collection_members (
  name TEXT NOT NULL REFERENCES collections(name) ON DELETE CASCADE,
  slug TEXT NOT NULL REFERENCES inspirations(slug) ON DELETE CASCADE,
  PRIMARY KEY (name, slug)
);

CREATE TABLE IF NOT EXISTS recipes (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  version    INTEGER NOT NULL,
  request    TEXT NOT NULL,               -- ComposeRequest JSON
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id         TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  slug       TEXT,
  status     TEXT NOT NULL,
  payload    TEXT NOT NULL,               -- staged input, so retry is resumable
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_stages (
  job_id      TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  stage       TEXT NOT NULL,
  status      TEXT NOT NULL,
  error       TEXT,
  started_at  TEXT,
  finished_at TEXT,
  PRIMARY KEY (job_id, stage)
);
