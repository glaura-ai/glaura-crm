/**
 * Publishes the bundled « Compte prêt » email into /modeles.
 *
 * The body is src/lib/onboarding/templates/welcome-salon.html — 35 KB of email
 * markup, which belongs in a file rather than a SQL literal, so the migration
 * only adds the columns and this script carries the content.
 *
 * Idempotent by design, with one deliberate asymmetry: an EXISTING row is left
 * alone unless `--force` is passed. Once the team has edited the template in
 * /modeles, a redeploy running this script must not silently overwrite their
 * copy with the one baked into the image.
 *
 *   npm run seed:welcome-template            # create if missing
 *   npm run seed:welcome-template -- --force # overwrite with the bundled copy
 */

import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const force = process.argv.includes("--force");

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { bundledWelcomeTemplate, WELCOME_SALON_TEMPLATE_KEY } = await import("../src/lib/onboarding/welcome-email");

  const bundled = bundledWelcomeTemplate();
  const existing = await prisma.emailTemplate.findUnique({
    where: { key: WELCOME_SALON_TEMPLATE_KEY },
    select: { id: true, updatedAt: true },
  });

  if (existing && !force) {
    console.log(`kept existing ${WELCOME_SALON_TEMPLATE_KEY} (edited ${existing.updatedAt.toISOString()}) — pass --force to overwrite`);
    return;
  }

  if (existing) {
    await prisma.emailTemplate.update({
      where: { id: existing.id },
      data: { subject: bundled.subject, body: bundled.body, format: "HTML", archivedAt: null },
    });
    console.log(`overwrote ${WELCOME_SALON_TEMPLATE_KEY} with the bundled template (${bundled.body.length} chars)`);
    return;
  }

  // Sits at the end of the dropdown: it is an account email, not the relance a
  // rep reaches for by default.
  const last = await prisma.emailTemplate.aggregate({ _max: { sortOrder: true } });
  await prisma.emailTemplate.create({
    data: {
      key: WELCOME_SALON_TEMPLATE_KEY,
      label: "Compte prêt (onboarding)",
      subject: bundled.subject,
      format: "HTML",
      body: bundled.body,
      sortOrder: (last._max.sortOrder ?? 0) + 1,
    },
  });
  console.log(`created ${WELCOME_SALON_TEMPLATE_KEY} (${bundled.body.length} chars)`);
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
