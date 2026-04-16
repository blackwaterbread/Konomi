-- Squashed migration: full schema as of 2026-03-23
-- Uses IF NOT EXISTS so existing databases are unaffected

-- CreateTable
CREATE TABLE IF NOT EXISTS "Folder" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PromptCategory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "isBuiltin" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PromptGroup" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    CONSTRAINT "PromptGroup_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "PromptCategory" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PromptToken" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "label" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "groupId" INTEGER NOT NULL,
    CONSTRAINT "PromptToken_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "PromptGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Category" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "isBuiltin" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ImageCategory" (
    "imageId" INTEGER NOT NULL,
    "categoryId" INTEGER NOT NULL,

    PRIMARY KEY ("imageId", "categoryId"),
    CONSTRAINT "ImageCategory_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "Image" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImageCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "NaiConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "apiKey" TEXT NOT NULL DEFAULT ''
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "IgnoredDuplicatePath" (
    "path" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ImageSearchStat" (
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "model" TEXT,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("kind", "key")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ImageSimilarityCache" (
    "imageAId" INTEGER NOT NULL,
    "imageBId" INTEGER NOT NULL,
    "phashDistance" INTEGER,
    "textScore" REAL NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("imageAId", "imageBId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ImageSimilarityCacheMeta" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "primedAt" DATETIME
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Image" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "path" TEXT NOT NULL,
    "folderId" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL DEFAULT '',
    "negativePrompt" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT '',
    "seed" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER NOT NULL DEFAULT 0,
    "height" INTEGER NOT NULL DEFAULT 0,
    "sampler" TEXT NOT NULL DEFAULT '',
    "steps" INTEGER NOT NULL DEFAULT 0,
    "cfgScale" REAL NOT NULL DEFAULT 0,
    "cfgRescale" REAL NOT NULL DEFAULT 0,
    "noiseSchedule" TEXT NOT NULL DEFAULT '',
    "varietyPlus" BOOLEAN NOT NULL DEFAULT false,
    "characterPrompts" TEXT NOT NULL DEFAULT '[]',
    "source" TEXT NOT NULL DEFAULT 'unknown',
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "pHash" TEXT NOT NULL DEFAULT '',
    "promptTokens" TEXT NOT NULL DEFAULT '[]',
    "negativePromptTokens" TEXT NOT NULL DEFAULT '[]',
    "characterPromptTokens" TEXT NOT NULL DEFAULT '[]',
    "fileSize" INTEGER NOT NULL DEFAULT 0,
    "fileModifiedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Image_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Folder_path_key" ON "Folder"("path");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "IgnoredDuplicatePath_createdAt_idx" ON "IgnoredDuplicatePath"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ImageSimilarityCache_imageAId_idx" ON "ImageSimilarityCache"("imageAId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ImageSimilarityCache_imageBId_idx" ON "ImageSimilarityCache"("imageBId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ImageSimilarityCache_phashDistance_idx" ON "ImageSimilarityCache"("phashDistance");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ImageSimilarityCache_textScore_idx" ON "ImageSimilarityCache"("textScore");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Image_path_key" ON "Image"("path");
