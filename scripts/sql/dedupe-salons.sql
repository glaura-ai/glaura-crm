-- Consolidate duplicate salons discovered by shared phone number.
--
-- NO SALON IS EVER DELETED. Losing records are archived (archivedAt set) and
-- linked to the survivor via mergedIntoId, so every merge is auditable and can
-- be undone with scripts/sql/undo-dedupe-salons.sql.
--
-- Safety rules baked in:
--   * only groups where every member normalizes to the SAME name are merged;
--     groups with materially different names are left for a human (they may be
--     separate businesses sharing a landline or booking-service number).
--   * the survivor is the record carrying the most history, so activity is
--     never orphaned; ties break toward the most advanced status, then oldest.
--   * status is promoted, never demoted — SIGNE always wins when present.
--   * fields are only ever filled in where the survivor was NULL; no value on
--     the survivor is overwritten.
--
-- Run inside a transaction. Set :apply to 1 to commit, anything else rolls back
-- after printing what it would do:
--   psql -d glaura_crm -v apply=0 -f dedupe-salons.sql

\set ON_ERROR_STOP on
BEGIN;

-- Every distinct French number a salon mentions; a salon is keyed by the
-- lowest one so that a field holding two numbers still groups deterministically.
CREATE TEMP TABLE cand ON COMMIT DROP AS
SELECT s.id,
       lower(regexp_replace(s.name, '[^a-zA-Z]', '', 'g')) AS norm_name,
       min(m[1])                                           AS grp
FROM "Salon" s,
     LATERAL regexp_matches(salon_phone_canonical(s.phone), '0[0-9]{9}', 'g') AS m
WHERE s.phone IS NOT NULL
  AND s."archivedAt" IS NULL
GROUP BY s.id;

-- Groups of >1 salon, split by whether the names agree.
CREATE TEMP TABLE grp ON COMMIT DROP AS
SELECT grp AS num, count(*) AS members, count(DISTINCT norm_name) AS distinct_names
FROM cand GROUP BY grp HAVING count(*) > 1;

CREATE TEMP TABLE ranked ON COMMIT DROP AS
SELECT c.id, c.grp, s.status, s."createdAt",
       CASE s.status
         WHEN 'SIGNE'         THEN 6 WHEN 'INTERESSE'    THEN 5
         WHEN 'A_RELANCER'    THEN 4 WHEN 'VISITE_FAITE' THEN 3
         WHEN 'A_VISITER'     THEN 2 WHEN 'PAS_INTERESSE' THEN 1
       END AS status_rank,
       (SELECT count(*) FROM "Activity"      x WHERE x."salonId" = c.id)
     + (SELECT count(*) FROM "Reminder"      x WHERE x."salonId" = c.id)
     + (SELECT count(*) FROM "OnboardingJob" x WHERE x."salonId" = c.id)
     + (SELECT count(*) FROM "EmailJob"      x WHERE x."salonId" = c.id) AS history
FROM cand c
JOIN "Salon" s ON s.id = c.id
WHERE c.grp IN (SELECT num FROM grp WHERE distinct_names = 1);

-- survivor = most history, then most advanced status, then oldest record
CREATE TEMP TABLE merge_map ON COMMIT DROP AS
WITH ordered AS (
  SELECT id, grp,
         row_number() OVER (PARTITION BY grp
                            ORDER BY history DESC, status_rank DESC, "createdAt" ASC, id ASC) AS rn
  FROM ranked
)
SELECT o.id AS loser_id, k.id AS survivor_id, o.grp
FROM ordered o
JOIN (SELECT grp, id FROM ordered WHERE rn = 1) k ON k.grp = o.grp
WHERE o.rn > 1;

\echo ''
\echo '======== PLAN ========'
SELECT (SELECT count(*) FROM grp)                                    AS dup_groups_found,
       (SELECT count(*) FROM grp WHERE distinct_names = 1)           AS groups_mergeable,
       (SELECT count(*) FROM grp WHERE distinct_names > 1)           AS groups_left_for_human,
       (SELECT count(*) FROM merge_map)                              AS salons_to_archive,
       (SELECT count(DISTINCT survivor_id) FROM merge_map)           AS survivors;

\echo ''
\echo '-- status promotions (SIGNE and other upgrades applied to survivors) --'
SELECT s.name, s.status AS current_status, best.best AS promoted_to
FROM (SELECT m.survivor_id, max(r.status_rank) AS best
      FROM merge_map m JOIN ranked r ON r.grp = m.grp GROUP BY m.survivor_id) x
JOIN LATERAL (SELECT CASE x.best WHEN 6 THEN 'SIGNE' WHEN 5 THEN 'INTERESSE'
                                 WHEN 4 THEN 'A_RELANCER' WHEN 3 THEN 'VISITE_FAITE'
                                 WHEN 2 THEN 'A_VISITER' ELSE 'PAS_INTERESSE' END AS best) best ON TRUE
JOIN "Salon" s ON s.id = x.survivor_id
WHERE s.status::text <> best.best;

\echo ''
\echo '-- groups deliberately NOT merged (names differ) --'
SELECT g.num, string_agg(DISTINCT s.name, '  |  ') AS names
FROM grp g JOIN cand c ON c.grp = g.num JOIN "Salon" s ON s.id = c.id
WHERE g.distinct_names > 1
GROUP BY g.num ORDER BY g.num;

--------------------------------------------------------------------------------
-- Apply
--------------------------------------------------------------------------------

-- 1. Move history onto the survivor so archiving never hides activity.
UPDATE "Activity"      c SET "salonId" = m.survivor_id FROM merge_map m WHERE c."salonId" = m.loser_id;
UPDATE "Reminder"      c SET "salonId" = m.survivor_id FROM merge_map m WHERE c."salonId" = m.loser_id;
UPDATE "OnboardingJob" c SET "salonId" = m.survivor_id FROM merge_map m WHERE c."salonId" = m.loser_id;
UPDATE "EmailJob"      c SET "salonId" = m.survivor_id FROM merge_map m WHERE c."salonId" = m.loser_id;

-- Prospect.salonId is UNIQUE, so only repoint when the survivor has no prospect.
UPDATE "Prospect" p SET "salonId" = m.survivor_id
FROM merge_map m
WHERE p."salonId" = m.loser_id
  AND NOT EXISTS (SELECT 1 FROM "Prospect" q WHERE q."salonId" = m.survivor_id);
UPDATE "Prospect" p SET "matchedSalonId" = m.survivor_id
FROM merge_map m WHERE p."matchedSalonId" = m.loser_id;

-- 2. Promote status (SIGNE wins), carrying signedAt across.
UPDATE "Salon" s
SET status = v.best::"SalonStatus",
    "signedAt" = COALESCE(s."signedAt", v.signed_at),
    "updatedAt" = now()
FROM (
  SELECT m.survivor_id,
         CASE max(r.status_rank) WHEN 6 THEN 'SIGNE' WHEN 5 THEN 'INTERESSE'
              WHEN 4 THEN 'A_RELANCER' WHEN 3 THEN 'VISITE_FAITE'
              WHEN 2 THEN 'A_VISITER' ELSE 'PAS_INTERESSE' END AS best,
         max(ls."signedAt") AS signed_at
  FROM merge_map m
  JOIN ranked r ON r.grp = m.grp
  JOIN "Salon" ls ON ls.id = r.id
  GROUP BY m.survivor_id
) v
WHERE s.id = v.survivor_id AND s.status::text <> v.best;

-- 3. Fill only the survivor's NULL fields from the archived twins.
UPDATE "Salon" s SET
  "contactEmail" = COALESCE(s."contactEmail", v."contactEmail"),
  "contactName"  = COALESCE(s."contactName",  v."contactName"),
  instagram      = COALESCE(s.instagram,      v.instagram),
  address        = COALESCE(s.address,        v.address),
  arrondissement = COALESCE(s.arrondissement, v.arrondissement),
  "bookingUrl"   = COALESCE(s."bookingUrl",   v."bookingUrl"),
  lat            = COALESCE(s.lat,            v.lat),
  lng            = COALESCE(s.lng,            v.lng),
  rating         = COALESCE(s.rating,         v.rating),
  "updatedAt"    = now()
FROM (
  SELECT m.survivor_id,
    (array_agg(l."contactEmail"  ORDER BY l."createdAt") FILTER (WHERE l."contactEmail"  IS NOT NULL))[1] AS "contactEmail",
    (array_agg(l."contactName"   ORDER BY l."createdAt") FILTER (WHERE l."contactName"   IS NOT NULL))[1] AS "contactName",
    (array_agg(l.instagram       ORDER BY l."createdAt") FILTER (WHERE l.instagram       IS NOT NULL))[1] AS instagram,
    (array_agg(l.address         ORDER BY l."createdAt") FILTER (WHERE l.address         IS NOT NULL))[1] AS address,
    (array_agg(l.arrondissement  ORDER BY l."createdAt") FILTER (WHERE l.arrondissement  IS NOT NULL))[1] AS arrondissement,
    (array_agg(l."bookingUrl"    ORDER BY l."createdAt") FILTER (WHERE l."bookingUrl"    IS NOT NULL))[1] AS "bookingUrl",
    (array_agg(l.lat             ORDER BY l."createdAt") FILTER (WHERE l.lat             IS NOT NULL))[1] AS lat,
    (array_agg(l.lng             ORDER BY l."createdAt") FILTER (WHERE l.lng             IS NOT NULL))[1] AS lng,
    (array_agg(l.rating          ORDER BY l."createdAt") FILTER (WHERE l.rating          IS NOT NULL))[1] AS rating
  FROM merge_map m JOIN "Salon" l ON l.id = m.loser_id
  GROUP BY m.survivor_id
) v
WHERE s.id = v.survivor_id;

-- 4. Archive the duplicates. Not deleted — hidden, linked and reversible.
UPDATE "Salon" s
SET "archivedAt"   = now(),
    "mergedIntoId" = m.survivor_id,
    "archiveNote"  = 'Doublon (même numéro de téléphone) fusionné le ' || to_char(now(), 'YYYY-MM-DD'),
    "updatedAt"    = now()
FROM merge_map m
WHERE s.id = m.loser_id;

\echo ''
\echo '======== RESULT ========'
SELECT (SELECT count(*) FROM "Salon")                              AS salons_total_unchanged,
       (SELECT count(*) FROM "Salon" WHERE "archivedAt" IS NOT NULL) AS archived,
       (SELECT count(*) FROM "Salon" WHERE "archivedAt" IS NULL)     AS active_pipeline;

\if :apply
  COMMIT;
  \echo 'COMMITTED.'
\else
  ROLLBACK;
  \echo 'DRY RUN — rolled back, nothing changed.'
\endif
