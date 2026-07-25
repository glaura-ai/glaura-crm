-- Indexes for the salon free-text search (getSalons in src/lib/salons.ts).
--
-- The search is a set of leading-wildcard ILIKE '%q%' predicates. B-tree cannot
-- serve those at all, so these are pg_trgm GIN indexes, which can.
--
-- Note on scale, measured at ~600 rows: the planner already uses the phone
-- index below (the function call is costly enough to beat a scan), but still
-- prefers a sequential scan for the six ILIKE columns, which is the right call
-- at this size. Those six are provisioned for growth, not for today.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Salon_name_trgm_idx" ON "Salon" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Salon_contactName_trgm_idx" ON "Salon" USING gin ("contactName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Salon_contactEmail_trgm_idx" ON "Salon" USING gin ("contactEmail" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Salon_instagram_trgm_idx" ON "Salon" USING gin ("instagram" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Salon_address_trgm_idx" ON "Salon" USING gin ("address" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Salon_notes_trgm_idx" ON "Salon" USING gin ("notes" gin_trgm_ops);

-- Phone numbers are stored unnormalized ("01 42 72 31 99", "'+33665349052" —
-- the leading apostrophe is a spreadsheet text-forcing artifact). Searching
-- them means reducing both sides to the French national form first.
--
-- This lives in the database as an IMMUTABLE function rather than inline SQL so
-- that the index below and the query in src/lib/salons.ts share one definition:
-- an expression index is only used when the query repeats the expression, and a
-- shared function call matches trivially where a copy-pasted CASE would drift.
CREATE OR REPLACE FUNCTION salon_phone_canonical(phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT CASE
           WHEN d LIKE '0033%' THEN '0' || substr(d, 5)
           WHEN d LIKE '33%' AND length(d) = 11 THEN '0' || substr(d, 3)
           ELSE d
         END
  FROM (SELECT regexp_replace(phone, '[^0-9]', '', 'g')) AS t(d);
$$;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Salon_phone_canonical_trgm_idx"
  ON "Salon" USING gin (salon_phone_canonical("phone") gin_trgm_ops);
