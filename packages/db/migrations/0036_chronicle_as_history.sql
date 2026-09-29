-- The Chronicle stops being prose and nothing else.
--
-- An entry now carries what moved on the map while it was happening, the few
-- subjects worth printing on its face, and -- at most once a report -- a line
-- of somebody's own voice. A "recorded" entry has no historian behind it at
-- all: it is the books, struck at the turn of the year, and the reader is shown
-- a table rather than a passage.
ALTER TABLE "chronicle_checkpoints" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'narrated';
ALTER TABLE "chronicle_checkpoints" ADD COLUMN IF NOT EXISTS "tags" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "chronicle_checkpoints" ADD COLUMN IF NOT EXISTS "changes" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "chronicle_checkpoints" ADD COLUMN IF NOT EXISTS "quote" jsonb;
