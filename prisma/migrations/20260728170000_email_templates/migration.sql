-- Email templates become editable data instead of a hardcoded enum + switch.
--
-- NOT additive: it converts EmailJob.template and drops the enum type, so the
-- old Prisma client errors on EmailJob reads once this has run. Deploy the new
-- image immediately after (see the deploy-crm skill).
--
-- The email worker never read EmailJob.template — it sends the stored
-- subject/body — so the column is pure provenance and safe to convert in place.

-- 1. Widen the enum column to text and rename it to what it now holds: a key
--    snapshot rather than an enum member.
ALTER TABLE "EmailJob" ALTER COLUMN "template" TYPE TEXT USING "template"::text;
ALTER TABLE "EmailJob" RENAME COLUMN "template" TO "templateKey";

DROP TYPE "EmailTemplate";

-- 2. The templates themselves.
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailTemplate_key_key" ON "EmailTemplate"("key");
CREATE INDEX "EmailTemplate_archivedAt_sortOrder_idx" ON "EmailTemplate"("archivedAt", "sortOrder");

ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. The four built-ins, carried over verbatim from buildEmailDraft() with the
--    interpolations rewritten as placeholders. INTRO's booking sentence was
--    conditional in code; as its own line it now disappears on its own when a
--    salon has no booking URL (see renderTemplate's empty-variable rule).
--
--    sortOrder puts RELANCE first because the form defaults to the first entry
--    and the old hardcoded form defaulted to "Relance" — reps should not find a
--    different template preselected the morning after this ships.
INSERT INTO "EmailTemplate" ("id", "key", "label", "subject", "body", "sortOrder", "updatedAt") VALUES
(
    'emtpl_intro_seed_0000000001',
    'INTRO',
    'Premier contact',
    'Glaura pour {{salon}}',
    E'Bonjour {{contact}},\n\nJe me permets de vous contacter pour {{salon}}. Glaura aide les salons à recevoir plus de réservations et à mieux convertir Instagram, Google et leur site en rendez-vous.\n\nEst-ce que vous seriez disponible cette semaine pour un échange de 10 minutes ?\n\nJ''ai vu votre page de réservation ici : {{bookingUrl}}\n\nBonne journée,\nL''équipe Glaura',
    1,
    CURRENT_TIMESTAMP
),
(
    'emtpl_demo_seed_00000000002',
    'DEMO_FOLLOW_UP',
    'Après démo',
    'Suite à notre démo Glaura',
    E'Bonjour {{contact}},\n\nMerci pour votre temps. Je vous renvoie les points clés vus ensemble pour {{salon}} : une page de réservation moderne, les services repris automatiquement et un parcours client plus simple.\n\nSouhaitez-vous que je vous prépare le compte pour validation ?\n\nBonne journée,\nL''équipe Glaura',
    2,
    CURRENT_TIMESTAMP
),
(
    'emtpl_relance_seed_000000003',
    'RELANCE',
    'Relance',
    'Relance Glaura - {{salon}}',
    E'Bonjour {{contact}},\n\nJe me permets de vous relancer au sujet de Glaura pour {{salon}}.\n\nEst-ce que vous souhaitez que l''on cale un court échange pour voir si cela peut vous aider à développer les réservations du salon ?\n\nBonne journée,\nL''équipe Glaura',
    0,
    CURRENT_TIMESTAMP
),
(
    'emtpl_signature_seed_0000004',
    'SIGNATURE_NEXT_STEPS',
    'Après signature',
    'Prochaines étapes pour {{salon}}',
    E'Bonjour {{contact}},\n\nLe compte Glaura de {{salon}} est en préparation. Je reviens vers vous dès que la première version est prête pour vérification.\n\nNous vérifierons ensemble les services, l''équipe, les horaires et la page de réservation avant activation.\n\nBonne journée,\nL''équipe Glaura',
    3,
    CURRENT_TIMESTAMP
);

-- 4. Link existing jobs to the seeded rows by their snapshotted key.
ALTER TABLE "EmailJob" ADD COLUMN "templateId" TEXT;

ALTER TABLE "EmailJob" ADD CONSTRAINT "EmailJob_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "EmailTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "EmailJob" j
   SET "templateId" = t."id"
  FROM "EmailTemplate" t
 WHERE t."key" = j."templateKey";
