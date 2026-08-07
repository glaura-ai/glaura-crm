/**
 * Publishes the bundled system emails into /modeles.
 *
 * The bodies live under src/lib/onboarding/templates. Email-compatible markup
 * belongs in files rather than SQL literals, so migrations add only schema and
 * this idempotent script publishes the editable rows.
 *
 * Idempotent by design, with one deliberate asymmetry: an EXISTING row is left
 * alone unless `--force` is passed. Once the team has edited the template in
 * /modeles, a redeploy running this script must not silently overwrite their
 * copy with the one baked into the image.
 *
 *   npm run seed:system-email-templates            # create if missing
 *   npm run seed:system-email-templates -- --force # overwrite bundled copies
 */

import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const force = process.argv.includes("--force");

async function main() {
  const { prisma } = await import("../src/lib/db");
  const [welcome, preview, activation] = await Promise.all([
    import("../src/lib/onboarding/welcome-email"),
    import("../src/lib/onboarding/pro-preview"),
    import("../src/lib/onboarding/magic-link"),
  ]);
  const definitions = [
    {
      key: welcome.WELCOME_SALON_TEMPLATE_KEY,
      label: "Compte prêt (onboarding)",
      template: welcome.bundledWelcomeTemplate(),
    },
    {
      key: preview.PRO_PREVIEW_READY_TEMPLATE_KEY,
      label: "Aperçu prêt (/pro)",
      template: preview.bundledProPreviewTemplate(),
    },
    {
      key: activation.PRO_ACTIVATION_READY_TEMPLATE_KEY,
      label: "Compte activé (/pro)",
      template: activation.bundledActivationReadyTemplate(),
    },
  ];

  let nextOrder = (await prisma.emailTemplate.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? 0;
  for (const definition of definitions) {
    const existing = await prisma.emailTemplate.findUnique({
      where: { key: definition.key },
      select: { id: true, updatedAt: true },
    });
    if (existing && !force) {
      console.log(`kept existing ${definition.key} (edited ${existing.updatedAt.toISOString()}) — pass --force to overwrite`);
      continue;
    }
    if (existing) {
      await prisma.emailTemplate.update({
        where: { id: existing.id },
        data: {
          label: definition.label,
          subject: definition.template.subject,
          body: definition.template.body,
          format: "HTML",
          archivedAt: null,
        },
      });
      console.log(`overwrote ${definition.key} (${definition.template.body.length} chars)`);
      continue;
    }
    nextOrder += 1;
    await prisma.emailTemplate.create({
      data: {
        key: definition.key,
        label: definition.label,
        subject: definition.template.subject,
        format: "HTML",
        body: definition.template.body,
        sortOrder: nextOrder,
      },
    });
    console.log(`created ${definition.key} (${definition.template.body.length} chars)`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { prisma } = await import("../src/lib/db");
    await prisma.$disconnect();
  });
