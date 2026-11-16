-- Widen ImageSearchStat.model to the 700 characters `key` allows. A tag row
-- keeps the tag as written in `model` and lower-cased in `key`, so a tag of
-- 501–700 characters fit the key but not `model`, and in strict mode the
-- whole search-stat write failed with `Data too long for column 'model'`.
--
-- `model` is in no index, so the 3072-byte index entry limit does not apply.
--
-- MODIFY COLUMN is idempotent — re-running on an already-widened DB is a
-- no-op, so this is safe to retry if the migration is interrupted.
ALTER TABLE `ImageSearchStat`
  MODIFY COLUMN `model` VARCHAR(700) NULL;
