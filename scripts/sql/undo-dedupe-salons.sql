-- Reverse a run of dedupe-salons.sql: un-archive every salon merged on a given
-- day and put it back in the pipeline.
--
--   psql -d glaura_crm -v day="'2026-07-25'" -v apply=0 -f undo-dedupe-salons.sql
--
-- Caveat, stated plainly: this restores the ARCHIVED RECORDS. It does not undo
-- the history repointing (activities/reminders/jobs moved onto the survivor), the
-- status promotion, or fields filled in on the survivor — those were merges, not
-- moves, and there is no record of the prior NULLs. Restored duplicates come back
-- without the history they used to own. Use it to recover from a wrong merge
-- decision, not as a general-purpose rollback.

\set ON_ERROR_STOP on
BEGIN;

\echo '-- salons that would be restored to the pipeline --'
SELECT s.id, s.name, s.status, s.phone, t.name AS was_merged_into
FROM "Salon" s LEFT JOIN "Salon" t ON t.id = s."mergedIntoId"
WHERE s."archivedAt" IS NOT NULL
  AND s."archivedAt"::date = (:day)::date
ORDER BY s.name;

UPDATE "Salon"
SET "archivedAt" = NULL, "mergedIntoId" = NULL, "archiveNote" = NULL, "updatedAt" = now()
WHERE "archivedAt" IS NOT NULL
  AND "archivedAt"::date = (:day)::date;

\if :apply
  COMMIT;
  \echo 'COMMITTED — duplicates restored.'
\else
  ROLLBACK;
  \echo 'DRY RUN — rolled back, nothing changed.'
\endif
