import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const promptsDBPath = path.resolve(process.cwd(), "database", "prompts.db");

if (!fs.existsSync(promptsDBPath)) {
  console.error(`Missing prompts DB: ${promptsDBPath}`);
  console.error("Run `bun run db:prompts -- <csv-path>` before packaging.");
  process.exit(1);
}

const stat = fs.statSync(promptsDBPath);
if (!stat.isFile() || stat.size <= 0) {
  console.error(`Invalid prompts DB: ${promptsDBPath}`);
  process.exit(1);
}

const db = new Database(promptsDBPath, { readonly: true, fileMustExist: true });
try {
  const metaRows = db
    .prepare(
      `SELECT key, value
       FROM prompts_meta
       WHERE key IN (
         'schema_version',
         'tag_count_total',
         'tag_count_max',
         'tag_count_bucket_thresholds',
         'tag_count_bucket_strategy'
       )`,
    )
    .all();
  const meta = new Map(metaRows.map((row) => [row.key, row.value]));
  const missingKeys = [
    "schema_version",
    "tag_count_total",
    "tag_count_max",
    "tag_count_bucket_thresholds",
    "tag_count_bucket_strategy",
  ].filter((key) => !meta.has(key));

  if (missingKeys.length > 0) {
    console.error(
      `prompts.db is missing required metadata keys: ${missingKeys.join(", ")}`,
    );
    console.error(
      "Rebuild the prompts DB with `bun run db:prompts -- <csv-path>`.",
    );
    process.exit(1);
  }

  const schemaVersion = Number.parseInt(meta.get("schema_version") ?? "0", 10);
  if (!Number.isFinite(schemaVersion) || schemaVersion < 3) {
    console.error(
      `prompts.db schema_version must be >= 3, got ${meta.get("schema_version")}`,
    );
    console.error(
      "Rebuild the prompts DB with `bun run db:prompts -- <csv-path>`.",
    );
    process.exit(1);
  }
} finally {
  db.close();
}

console.log(`Verified prompts DB: ${promptsDBPath}`);
