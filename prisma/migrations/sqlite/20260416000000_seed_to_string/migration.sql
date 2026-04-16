-- Convert seed column from INTEGER to TEXT
-- SQLite: create new table, migrate data, swap
CREATE TABLE "Image_new" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "path" TEXT NOT NULL,
    "folderId" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL DEFAULT '',
    "negativePrompt" TEXT NOT NULL DEFAULT '',
    "characterPrompts" TEXT NOT NULL DEFAULT '[]',
    "promptTokens" TEXT NOT NULL DEFAULT '[]',
    "negativePromptTokens" TEXT NOT NULL DEFAULT '[]',
    "characterPromptTokens" TEXT NOT NULL DEFAULT '[]',
    "source" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT '',
    "seed" TEXT NOT NULL DEFAULT '',
    "width" INTEGER NOT NULL DEFAULT 0,
    "height" INTEGER NOT NULL DEFAULT 0,
    "sampler" TEXT NOT NULL DEFAULT '',
    "steps" INTEGER NOT NULL DEFAULT 0,
    "cfgScale" REAL NOT NULL DEFAULT 0,
    "cfgRescale" REAL NOT NULL DEFAULT 0,
    "noiseSchedule" TEXT NOT NULL DEFAULT '',
    "varietyPlus" BOOLEAN NOT NULL DEFAULT false,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "pHash" TEXT NOT NULL DEFAULT '',
    "fileSize" INTEGER NOT NULL DEFAULT 0,
    "fileModifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Image_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "Image_new" SELECT
    "id", "path", "folderId", "prompt", "negativePrompt", "characterPrompts",
    "promptTokens", "negativePromptTokens", "characterPromptTokens",
    "source", "model",
    CASE WHEN "seed" = 0 THEN '' ELSE CAST("seed" AS TEXT) END,
    "width", "height", "sampler", "steps", "cfgScale", "cfgRescale",
    "noiseSchedule", "varietyPlus", "isFavorite", "pHash",
    "fileSize", "fileModifiedAt", "createdAt"
FROM "Image";

DROP TABLE "Image";
ALTER TABLE "Image_new" RENAME TO "Image";

-- Recreate indexes
CREATE UNIQUE INDEX "Image_path_key" ON "Image"("path");
CREATE INDEX "Image_folderId_fileModifiedAt_id_idx" ON "Image"("folderId", "fileModifiedAt", "id");
CREATE INDEX "Image_folderId_isFavorite_fileModifiedAt_id_idx" ON "Image"("folderId", "isFavorite", "fileModifiedAt", "id");
CREATE INDEX "Image_folderId_path_id_idx" ON "Image"("folderId", "path", "id");
