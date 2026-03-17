import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";

// Reference only.
// This script preserves the earlier "rich" CSV -> SQLite builder idea.
// It is not wired into package.json and is not used by the app right now.

const PROMPTS_DB_FILENAME = "prompts-rich-reference.db";
const PROMPTS_SCHEMA_VERSION = 1;
const APP_USER_DATA_DIRNAME = "Konomi";

function resolveDefaultOutputPath() {
  const userDataOverride = (process.env.KONOMI_USER_DATA ?? "").trim();
  if (userDataOverride) {
    return path.join(userDataOverride, PROMPTS_DB_FILENAME);
  }

  if (process.platform === "win32") {
    const appDataDir =
      process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appDataDir, APP_USER_DATA_DIRNAME, PROMPTS_DB_FILENAME);
  }

  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      APP_USER_DATA_DIRNAME,
      PROMPTS_DB_FILENAME,
    );
  }

  const xdgConfigHome =
    process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(
    xdgConfigHome,
    APP_USER_DATA_DIRNAME,
    PROMPTS_DB_FILENAME,
  );
}

const DEFAULT_OUTPUT_PATH = resolveDefaultOutputPath();

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS prompts_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS prompt_tag (
  id INTEGER PRIMARY KEY,
  tag TEXT NOT NULL,
  post_count INTEGER NOT NULL DEFAULT 0,
  category_path TEXT NOT NULL DEFAULT '',
  keywords_json TEXT NOT NULL DEFAULT '[]',
  source_dataset TEXT NOT NULL DEFAULT '',
  source_row INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(length(tag) > 0),
  CHECK(post_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_tag_tag
  ON prompt_tag(tag);

CREATE INDEX IF NOT EXISTS idx_prompt_tag_post_count
  ON prompt_tag(post_count DESC, id ASC);

CREATE TABLE IF NOT EXISTS prompt_lookup (
  id INTEGER PRIMARY KEY,
  tag_id INTEGER NOT NULL REFERENCES prompt_tag(id) ON DELETE CASCADE,
  term TEXT NOT NULL,
  normalized_term TEXT NOT NULL,
  kind TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  locale TEXT NOT NULL DEFAULT 'en',
  CHECK(kind IN ('canonical', 'keyword', 'translation')),
  CHECK(length(term) > 0),
  CHECK(length(normalized_term) > 0),
  CHECK(weight >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_lookup_unique
  ON prompt_lookup(tag_id, normalized_term, kind, locale);

CREATE INDEX IF NOT EXISTS idx_prompt_lookup_prefix
  ON prompt_lookup(
    normalized_term,
    weight DESC,
    sort_order ASC,
    tag_id ASC
  );

CREATE INDEX IF NOT EXISTS idx_prompt_lookup_kind_prefix
  ON prompt_lookup(
    kind,
    normalized_term,
    weight DESC,
    sort_order ASC,
    tag_id ASC
  );

CREATE INDEX IF NOT EXISTS idx_prompt_lookup_tag_id
  ON prompt_lookup(tag_id);
`;

function printUsageAndExit() {
  console.error(
    "Usage: node ./scripts/build-prompts-db-rich-reference.mjs <csv-path> [--out <output-db-path>]",
  );
  process.exit(1);
}

function parseArgs(argv) {
  let csvPath = "";
  let outputPath = DEFAULT_OUTPUT_PATH;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") {
      outputPath = path.resolve(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (!csvPath) {
      csvPath = path.resolve(arg);
      continue;
    }
    printUsageAndExit();
  }

  if (!csvPath) {
    printUsageAndExit();
  }

  return { csvPath, outputPath };
}

function normalizePromptTerm(value) {
  return value.trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ");
}

function* parseDatasetRows(text) {
  const lines = text.split(/\r?\n/);
  const recordStartPattern = /^[^,\r\n]*,\d+,\d+,/;
  let currentRecord = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (recordStartPattern.test(line)) {
      if (currentRecord) {
        yield currentRecord;
      }
      currentRecord = {
        lineNumber: i + 1,
        raw: line,
      };
      continue;
    }

    if (!currentRecord) {
      if (!line.trim()) continue;
      throw new Error(`Invalid CSV row at line ${i + 1}`);
    }

    currentRecord.raw += `\n${line}`;
  }

  if (currentRecord) {
    yield currentRecord;
  }
}

function parseDatasetRecord(rawRecord) {
  const firstComma = rawRecord.indexOf(",");
  const secondComma = rawRecord.indexOf(",", firstComma + 1);
  const thirdComma = rawRecord.indexOf(",", secondComma + 1);

  if (firstComma < 0 || secondComma < 0 || thirdComma < 0) {
    throw new Error("Invalid prompt CSV record");
  }

  let rawDescription = rawRecord.slice(thirdComma + 1).trim();
  if (rawDescription.startsWith('"') && rawDescription.endsWith('"')) {
    rawDescription = rawDescription.slice(1, -1).replace(/""/g, '"');
  }

  return {
    tag: rawRecord.slice(0, firstComma).trim(),
    category: Number.parseInt(
      rawRecord.slice(firstComma + 1, secondComma).trim() || "0",
      10,
    ) || 0,
    postCount: Math.max(
      0,
      Number.parseInt(
        rawRecord.slice(secondComma + 1, thirdComma).trim() || "0",
        10,
      ) || 0,
    ),
    rawDescription,
  };
}

function parseDescription(rawDescription) {
  const raw = String(rawDescription ?? "").trim();
  const categoryMatch = raw.match(/^\[([^\]]+)\]\s*/);
  const categoryPath = categoryMatch ? categoryMatch[1].trim() : "";
  let body = categoryMatch ? raw.slice(categoryMatch[0].length).trim() : raw;
  const keywordIndex = body.lastIndexOf("키워드:");
  let keywords = [];

  if (keywordIndex >= 0) {
    const keywordChunk = body.slice(keywordIndex + "키워드:".length).trim();
    keywords = keywordChunk
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    body = body.slice(0, keywordIndex).trim().replace(/[.\s]+$/g, "");
  }

  return {
    categoryPath,
    description: body,
    keywords,
  };
}

function ensureSchema(db, sourceDataset) {
  db.exec(SCHEMA_SQL);

  const upsertMeta = db.prepare(
    `INSERT INTO prompts_meta (key, value)
     VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );

  const transaction = db.transaction(() => {
    upsertMeta.run("schema_version", String(PROMPTS_SCHEMA_VERSION));
    upsertMeta.run("db_filename", PROMPTS_DB_FILENAME);
    upsertMeta.run("source_dataset", sourceDataset);
    upsertMeta.run("lookup_mode", "canonical+keyword+translation");
    upsertMeta.run(
      "schema_notes",
      "Reference-only rich builder with description-derived category path and keyword lookups.",
    );
    upsertMeta.run("built_at", new Date().toISOString());
  });

  transaction();
}

async function buildPromptsDB(csvPath, outputPath) {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found: ${csvPath}`);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.rmSync(outputPath, { force: true });

  const db = new Database(outputPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("temp_store = MEMORY");
  db.pragma("cache_size = -64000");

  ensureSchema(db, path.basename(csvPath));

  const insertTag = db.prepare(
    `INSERT OR IGNORE INTO prompt_tag (
       tag,
       post_count,
       category_path,
       keywords_json,
       source_dataset,
       source_row
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  );

  const updateExistingTag = db.prepare(
    `UPDATE prompt_tag
     SET
       post_count = CASE
         WHEN post_count < ? THEN ?
         ELSE post_count
       END,
       category_path = CASE
         WHEN category_path = '' AND ? <> '' THEN ?
         ELSE category_path
       END,
       keywords_json = CASE
         WHEN keywords_json = '[]' AND ? <> '[]' THEN ?
         ELSE keywords_json
       END
     WHERE tag = ?`,
  );

  const selectTagId = db.prepare(
    `SELECT id FROM prompt_tag WHERE tag = ? LIMIT 1`,
  );

  const insertLookup = db.prepare(
    `INSERT OR IGNORE INTO prompt_lookup (
       tag_id,
       term,
       normalized_term,
       kind,
       weight,
       sort_order,
       locale
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  const insertRows = db.transaction((rows) => {
    for (const row of rows) {
      const info = insertTag.run(
        row.tag,
        row.postCount,
        row.categoryPath,
        row.keywordsJson,
        row.sourceDataset,
        row.sourceRow,
      );

      if (info.changes === 0) {
        updateExistingTag.run(
          row.postCount,
          row.postCount,
          row.categoryPath,
          row.categoryPath,
          row.keywordsJson,
          row.keywordsJson,
          row.tag,
        );
      }

      const tagIdRow = info.changes
        ? { id: Number(info.lastInsertRowid) }
        : selectTagId.get(row.tag);

      if (!tagIdRow?.id) {
        throw new Error(`Failed to resolve prompt tag id for ${row.tag}`);
      }

      const tagId = Number(tagIdRow.id);

      insertLookup.run(
        tagId,
        row.tag,
        normalizePromptTerm(row.tag),
        "canonical",
        100,
        0,
        "en",
      );

      row.keywords.forEach((keyword, index) => {
        insertLookup.run(
          tagId,
          keyword,
          normalizePromptTerm(keyword),
          "keyword",
          50,
          index,
          "ko",
        );
      });
    }
  });

  const rows = [];
  let inserted = 0;
  const batchSize = 1000;
  const csvText = fs.readFileSync(csvPath, "utf8");

  for (const record of parseDatasetRows(csvText)) {
    const { lineNumber } = record;
    const { tag, category, postCount, rawDescription } = parseDatasetRecord(
      record.raw,
    );
    const { categoryPath, keywords } = parseDescription(rawDescription);

    rows.push({
      tag,
      category,
      postCount,
      categoryPath,
      keywordsJson: JSON.stringify(keywords),
      keywords,
      sourceDataset: path.basename(csvPath),
      sourceRow: lineNumber,
    });

    if (rows.length >= batchSize) {
      const batch = rows.splice(0, rows.length);
      insertRows(batch);
      inserted += batch.length;
    }
  }

  if (rows.length > 0) {
    const batch = rows.splice(0, rows.length);
    insertRows(batch);
    inserted += batch.length;
  }

  db.exec("ANALYZE");
  db.exec("VACUUM");
  db.close();

  return inserted;
}

async function main() {
  const { csvPath, outputPath } = parseArgs(process.argv.slice(2));
  const inserted = await buildPromptsDB(csvPath, outputPath);
  console.log(`Built ${outputPath} from ${csvPath}`);
  console.log(`Inserted ${inserted} prompt tags`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
