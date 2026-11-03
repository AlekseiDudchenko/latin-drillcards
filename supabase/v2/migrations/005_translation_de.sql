-- German as a translation language beside ru and en. Forward migration for projects that applied
-- 001 before it allowed 'de'; idempotent, so a fresh project may run it too.
SET LOCAL lock_timeout = '5s';
ALTER TABLE catalog_private.word_translations DROP CONSTRAINT IF EXISTS word_translations_language_check;
ALTER TABLE catalog_private.word_translations ADD CONSTRAINT word_translations_language_check CHECK (language IN ('ru','en','de'));
ALTER TABLE catalog_private.example_translations DROP CONSTRAINT IF EXISTS example_translations_language_check;
ALTER TABLE catalog_private.example_translations ADD CONSTRAINT example_translations_language_check CHECK (language IN ('ru','en','de'));
