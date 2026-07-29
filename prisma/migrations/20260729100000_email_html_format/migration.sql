-- HTML-capable email templates.
--
-- Purely additive: every existing row keeps sending exactly as before because
-- both new columns default to TEXT, which is the branch the worker already
-- takes. The « Compte prêt » row itself is NOT seeded here — its body is the
-- 35 KB src/lib/onboarding/templates/welcome-salon.html, which belongs in a file
-- rather than a SQL literal. `npm run seed:welcome-template` upserts it from
-- that file and is safe to re-run (see the deploy-crm skill).

CREATE TYPE "EmailFormat" AS ENUM ('TEXT', 'HTML');

ALTER TABLE "EmailTemplate" ADD COLUMN "format" "EmailFormat" NOT NULL DEFAULT 'TEXT';

-- Snapshot of the template's format at queue time, alongside templateKey: the
-- worker must keep sending a queued job the way it was composed even if the
-- template is edited or archived in between.
ALTER TABLE "EmailJob" ADD COLUMN "format" "EmailFormat" NOT NULL DEFAULT 'TEXT';
ALTER TABLE "EmailJob" ADD COLUMN "bodyText" TEXT;
