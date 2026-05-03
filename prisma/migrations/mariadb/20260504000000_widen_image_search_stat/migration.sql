-- Widen ImageSearchStat columns so long natural-language prompt tokens
-- (full-sentence captions, copy-pasted descriptions) no longer crash the
-- search-stats rebuild with `Data too long for column 'key'`.
--
-- The original VARCHAR(191) was chosen for the legacy InnoDB 767-byte
-- index prefix limit (191 * 4 bytes = 764). Modern MariaDB with DYNAMIC
-- row format allows up to 3072 bytes per index entry, so we can grow
-- `key` to 700 chars while shrinking `kind` to its real range
-- ('tag' | 'model' | 'resolution'). New PK row weight: (32+700)*4 = 2928
-- bytes, comfortably under the 3072-byte index limit.
--
-- MODIFY COLUMN is idempotent — re-running on an already-widened DB is a
-- no-op, so this is safe to retry if the migration is interrupted.
ALTER TABLE `ImageSearchStat`
  MODIFY COLUMN `kind`  VARCHAR(32)  NOT NULL,
  MODIFY COLUMN `key`   VARCHAR(700) NOT NULL,
  MODIFY COLUMN `model` VARCHAR(500) NULL;
