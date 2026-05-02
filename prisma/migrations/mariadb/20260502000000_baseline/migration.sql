-- Konomi MariaDB baseline schema (squashed)
-- Uses IF NOT EXISTS so existing databases (created from the legacy
-- docker/init.sql script) are unaffected.

-- CreateTable
CREATE TABLE IF NOT EXISTS `Folder` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `path` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastScanFileCount` INTEGER NULL,
    `lastScanFinishedAt` DATETIME(3) NULL,

    UNIQUE INDEX `Folder_path_key`(`path`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `PromptCategory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `isBuiltin` BOOLEAN NOT NULL DEFAULT false,
    `order` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `PromptGroup` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `categoryId` INTEGER NOT NULL,
    `order` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `PromptToken` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `label` VARCHAR(191) NOT NULL,
    `order` INTEGER NOT NULL,
    `groupId` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `Category` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `isBuiltin` BOOLEAN NOT NULL DEFAULT false,
    `order` INTEGER NOT NULL DEFAULT 0,
    `color` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `ImageCategory` (
    `imageId` INTEGER NOT NULL,
    `categoryId` INTEGER NOT NULL,

    PRIMARY KEY (`imageId`, `categoryId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `NaiConfig` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `apiKey` VARCHAR(191) NOT NULL DEFAULT '',

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `IgnoredDuplicatePath` (
    `path` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `IgnoredDuplicatePath_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`path`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `ImageSearchStat` (
    `kind` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `model` VARCHAR(191) NULL,
    `count` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`kind`, `key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `ImageSimilarityCache` (
    `imageAId` INTEGER NOT NULL,
    `imageBId` INTEGER NOT NULL,
    `phashDistance` INTEGER NULL,
    `textScore` DOUBLE NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ImageSimilarityCache_imageAId_idx`(`imageAId`),
    INDEX `ImageSimilarityCache_imageBId_idx`(`imageBId`),
    INDEX `ImageSimilarityCache_phashDistance_idx`(`phashDistance`),
    INDEX `ImageSimilarityCache_textScore_idx`(`textScore`),
    PRIMARY KEY (`imageAId`, `imageBId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `ImageSimilarityCacheMeta` (
    `id` INTEGER NOT NULL,
    `primedAt` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `Image` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `path` VARCHAR(191) NOT NULL,
    `folderId` INTEGER NOT NULL,
    `prompt` TEXT NOT NULL DEFAULT '',
    `negativePrompt` TEXT NOT NULL DEFAULT '',
    `model` VARCHAR(191) NOT NULL DEFAULT '',
    `seed` VARCHAR(191) NOT NULL DEFAULT '',
    `width` INTEGER NOT NULL DEFAULT 0,
    `height` INTEGER NOT NULL DEFAULT 0,
    `sampler` VARCHAR(191) NOT NULL DEFAULT '',
    `steps` INTEGER NOT NULL DEFAULT 0,
    `cfgScale` DOUBLE NOT NULL DEFAULT 0,
    `cfgRescale` DOUBLE NOT NULL DEFAULT 0,
    `noiseSchedule` VARCHAR(191) NOT NULL DEFAULT '',
    `varietyPlus` BOOLEAN NOT NULL DEFAULT false,
    `characterPrompts` TEXT NOT NULL DEFAULT '[]',
    `source` VARCHAR(191) NOT NULL DEFAULT 'unknown',
    `isFavorite` BOOLEAN NOT NULL DEFAULT false,
    `pHash` VARCHAR(191) NOT NULL DEFAULT '',
    `promptTokens` TEXT NOT NULL DEFAULT '[]',
    `negativePromptTokens` TEXT NOT NULL DEFAULT '[]',
    `characterPromptTokens` TEXT NOT NULL DEFAULT '[]',
    `fileSize` INTEGER NOT NULL DEFAULT 0,
    `fileModifiedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Image_path_key`(`path`),
    INDEX `Image_folderId_fileModifiedAt_id_idx`(`folderId`, `fileModifiedAt`, `id`),
    INDEX `Image_folderId_isFavorite_fileModifiedAt_id_idx`(`folderId`, `isFavorite`, `fileModifiedAt`, `id`),
    INDEX `Image_folderId_path_id_idx`(`folderId`, `path`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey (idempotent: skip if constraint already exists)
SET @fk_exists = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_NAME = 'PromptGroup_categoryId_fkey' AND TABLE_SCHEMA = DATABASE());
SET @sql = IF(@fk_exists = 0, 'ALTER TABLE `PromptGroup` ADD CONSTRAINT `PromptGroup_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `PromptCategory`(`id`) ON DELETE CASCADE ON UPDATE CASCADE', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk_exists = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_NAME = 'PromptToken_groupId_fkey' AND TABLE_SCHEMA = DATABASE());
SET @sql = IF(@fk_exists = 0, 'ALTER TABLE `PromptToken` ADD CONSTRAINT `PromptToken_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `PromptGroup`(`id`) ON DELETE CASCADE ON UPDATE CASCADE', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk_exists = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_NAME = 'ImageCategory_imageId_fkey' AND TABLE_SCHEMA = DATABASE());
SET @sql = IF(@fk_exists = 0, 'ALTER TABLE `ImageCategory` ADD CONSTRAINT `ImageCategory_imageId_fkey` FOREIGN KEY (`imageId`) REFERENCES `Image`(`id`) ON DELETE CASCADE ON UPDATE CASCADE', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk_exists = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_NAME = 'ImageCategory_categoryId_fkey' AND TABLE_SCHEMA = DATABASE());
SET @sql = IF(@fk_exists = 0, 'ALTER TABLE `ImageCategory` ADD CONSTRAINT `ImageCategory_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE CASCADE ON UPDATE CASCADE', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk_exists = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_NAME = 'Image_folderId_fkey' AND TABLE_SCHEMA = DATABASE());
SET @sql = IF(@fk_exists = 0, 'ALTER TABLE `Image` ADD CONSTRAINT `Image_folderId_fkey` FOREIGN KEY (`folderId`) REFERENCES `Folder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
