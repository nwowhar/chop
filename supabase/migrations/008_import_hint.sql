-- ============================================================
-- Chop — 008_import_hint.sql
--
-- An optional dish name typed at import time. Useful when the
-- screenshot starts partway down a caption, when the post names
-- the dish only in a video, or when the parser's guess would be
-- wrong ("coriander" the herb vs the spice, that sort of thing).
--
-- The hint becomes the title outright, and steers ambiguous
-- ingredient readings.
-- ============================================================

alter table import_jobs
  add column if not exists hint text;

comment on column import_jobs.hint is
  'Optional dish name supplied by the user at import. Overrides the parsed title.';
