import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const PROMPTS_DB_FILENAME = "prompts.db";
const PROMPTS_SCHEMA_VERSION = 3;
const TAG_COUNT_BUCKET_PERCENTILES = [0.8, 0.95, 0.99, 0.999];
const DEFAULT_OUTPUT_PATH = path.resolve(
  process.cwd(),
  "database",
  PROMPTS_DB_FILENAME,
);

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS prompts_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS prompt_tag (
  id INTEGER PRIMARY KEY,
  tag TEXT NOT NULL,
  post_count INTEGER NOT NULL DEFAULT 0,
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

CREATE INDEX IF NOT EXISTS idx_prompt_tag_search
  ON prompt_tag(
    LOWER(REPLACE(tag, '_', ' ')),
    post_count DESC,
    tag ASC
  );
`;

function printUsageAndExit() {
  console.error(
    "Usage: npm run db:prompts -- <csv-path> [--out <output-db-path>]",
  );
  console.error(`Default output: ${DEFAULT_OUTPUT_PATH}`);
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

  return {
    tag: rawRecord.slice(0, firstComma).trim(),
    postCount: Math.max(
      0,
      Number.parseInt(
        rawRecord.slice(secondComma + 1, thirdComma).trim() || "0",
        10,
      ) || 0,
    ),
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
    upsertMeta.run("search_field", "tag");
    upsertMeta.run("search_rank", "post_count_desc");
    upsertMeta.run(
      "schema_notes",
      "prompt_tag stores prompt autocomplete tags ranked by post_count. prompts_meta also stores global post_count bucket metadata for renderer autocomplete indicators.",
    );
    upsertMeta.run("built_at", new Date().toISOString());
  });

  transaction();
}

function computeTagCountStats(db) {
  const summary = db
    .prepare(
      `SELECT
         COUNT(*) AS total_tags,
         COALESCE(MAX(post_count), 0) AS max_post_count
       FROM prompt_tag`,
    )
    .get();

  const totalTags = Math.max(
    0,
    Number.parseInt(String(summary?.total_tags ?? "0"), 10) || 0,
  );
  const maxPostCount = Math.max(
    0,
    Number.parseInt(String(summary?.max_post_count ?? "0"), 10) || 0,
  );

  if (totalTags === 0) {
    return {
      totalTags,
      maxPostCount,
      percentile95PostCount: 0,
      scaleMaxPostCount: 0,
      bucketPercentiles: TAG_COUNT_BUCKET_PERCENTILES,
      bucketThresholds: [],
    };
  }

  const selectPostCountAtOffset = db.prepare(
    `SELECT post_count
     FROM prompt_tag
     ORDER BY post_count DESC, id ASC
     LIMIT 1 OFFSET ?`,
  );
  const getPercentilePostCount = (percentile) => {
    const topFraction = Math.max(0, 1 - percentile);
    const offset = Math.max(0, Math.ceil(totalTags * topFraction) - 1);
    const row = selectPostCountAtOffset.get(offset);
    return Math.max(
      0,
      Number.parseInt(String(row?.post_count ?? "0"), 10) || 0,
    );
  };

  const percentile95PostCount = getPercentilePostCount(0.95);
  const bucketThresholds = TAG_COUNT_BUCKET_PERCENTILES.map(
    getPercentilePostCount,
  );

  return {
    totalTags,
    maxPostCount,
    percentile95PostCount,
    scaleMaxPostCount: Math.max(1, percentile95PostCount || maxPostCount),
    bucketPercentiles: TAG_COUNT_BUCKET_PERCENTILES,
    bucketThresholds,
  };
}

function writeTagCountStatsMeta(db) {
  const stats = computeTagCountStats(db);
  const upsertMeta = db.prepare(
    `INSERT INTO prompts_meta (key, value)
     VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );

  db.transaction(() => {
    upsertMeta.run("tag_count_total", String(stats.totalTags));
    upsertMeta.run("tag_count_max", String(stats.maxPostCount));
    upsertMeta.run("tag_count_p95", String(stats.percentile95PostCount));
    upsertMeta.run("tag_count_scale_max", String(stats.scaleMaxPostCount));
    upsertMeta.run("tag_count_scale_strategy", "log_clamp_p95");
    upsertMeta.run(
      "tag_count_bucket_percentiles",
      JSON.stringify(stats.bucketPercentiles),
    );
    upsertMeta.run(
      "tag_count_bucket_thresholds",
      JSON.stringify(stats.bucketThresholds),
    );
    upsertMeta.run("tag_count_bucket_strategy", "global_percentile_buckets");
  })();
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
       source_row
     ) VALUES (?, ?, ?)`,
  );

  const updateExistingTag = db.prepare(
    `UPDATE prompt_tag
     SET
       post_count = CASE
         WHEN post_count < ? THEN ?
         ELSE post_count
       END
     WHERE tag = ?`,
  );

  const insertRows = db.transaction((rows) => {
    for (const row of rows) {
      const info = insertTag.run(row.tag, row.postCount, row.sourceRow);
      if (info.changes === 0) {
        updateExistingTag.run(row.postCount, row.postCount, row.tag);
      }
    }
  });

  const rows = [];
  let inserted = 0;
  const batchSize = 1000;
  const csvText = fs.readFileSync(csvPath, "utf8");

  for (const record of parseDatasetRows(csvText)) {
    const { lineNumber } = record;
    const { tag, postCount } = parseDatasetRecord(record.raw);

    rows.push({
      tag,
      postCount,
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

  writeTagCountStatsMeta(db);
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
