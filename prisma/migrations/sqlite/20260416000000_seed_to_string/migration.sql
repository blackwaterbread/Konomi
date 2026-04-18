-- Convert seed column from INTEGER to TEXT
-- Avoid DROP TABLE to prevent cascade delete on ImageCategory when foreign_keys=ON
-- SQLite 3.35+ supports ALTER TABLE DROP COLUMN / RENAME COLUMN

ALTER TABLE "Image" ADD COLUMN "seed_text" TEXT NOT NULL DEFAULT '';
UPDATE "Image" SET "seed_text" = CASE WHEN "seed" = 0 THEN '' ELSE CAST("seed" AS TEXT) END;
ALTER TABLE "Image" DROP COLUMN "seed";
ALTER TABLE "Image" RENAME COLUMN "seed_text" TO "seed";
