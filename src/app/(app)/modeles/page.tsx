import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { EmailTemplateForm } from "@/components/EmailTemplateForm";
import { SubmitButton } from "@/components/SubmitButton";
import { archiveEmailTemplate, createEmailTemplate, restoreEmailTemplate, updateEmailTemplate } from "@/lib/actions";

const card = "rounded-xl border border-slate-300 bg-white p-5 shadow-sm";

/**
 * Org-wide email templates. Editing is open to any signed-in user, so this page
 * is intentionally plain: one list, one form, no per-user drafts. `?edit=<id>`
 * and `?new=1` drive which editor is open rather than client state, which keeps
 * a half-written template out of the way of a page refresh.
 */
export default async function EmailTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; new?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) notFound();

  const { edit, new: isNew } = await searchParams;

  const templates = await prisma.emailTemplate.findMany({
    orderBy: [{ archivedAt: "asc" }, { sortOrder: "asc" }],
    include: { createdBy: { select: { name: true, email: true } } },
  });

  const editing = edit ? templates.find((template) => template.id === edit) : undefined;
  const active = templates.filter((template) => !template.archivedAt);

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-950">Modèles d&apos;email</h1>
          <p className="mt-1 text-sm text-slate-500">
            Utilisés dans la fiche salon. Toute modification s&apos;applique immédiatement à toute l&apos;équipe.
          </p>
        </div>
        {!isNew && !editing && (
          <Link
            href="/modeles?new=1"
            className="rounded-lg bg-rose-500 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-rose-600"
          >
            + Nouveau modèle
          </Link>
        )}
      </div>

      {isNew && (
        <div className={`${card} mb-6`}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-950">Nouveau modèle</h2>
            <Link href="/modeles" className="text-xs font-semibold text-slate-500 hover:underline">Annuler</Link>
          </div>
          <EmailTemplateForm action={createEmailTemplate} submitLabel="Créer le modèle" />
        </div>
      )}

      {editing && (
        <div className={`${card} mb-6`}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-950">Modifier « {editing.label} »</h2>
            <Link href="/modeles" className="text-xs font-semibold text-slate-500 hover:underline">Annuler</Link>
          </div>
          <EmailTemplateForm
            action={updateEmailTemplate.bind(null, editing.id)}
            template={{ label: editing.label, subject: editing.subject, body: editing.body, format: editing.format }}
            submitLabel="Enregistrer"
          />
        </div>
      )}

      <div className={card}>
        <h2 className="mb-4 text-base font-semibold text-slate-950">
          {active.length} modèle{active.length > 1 ? "s" : ""} actif{active.length > 1 ? "s" : ""}
        </h2>
        <ul className="divide-y divide-slate-200">
          {templates.map((template) => (
            <li key={template.id} className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-900">{template.label}</span>
                  {template.format === "HTML" && (
                    <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-violet-200">HTML</span>
                  )}
                  {template.archivedAt && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">Archivé</span>
                  )}
                </div>
                <p className="truncate text-sm text-slate-600">{template.subject}</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  Modifié le {new Date(template.updatedAt).toLocaleDateString("fr-FR")}
                  {template.createdBy && ` · créé par ${template.createdBy.name ?? template.createdBy.email}`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Link href={`/modeles?edit=${template.id}`} className="text-xs font-semibold text-rose-600 hover:underline">
                  Modifier
                </Link>
                {template.archivedAt ? (
                  <form action={restoreEmailTemplate.bind(null, template.id)}>
                    <SubmitButton className="text-xs font-semibold text-slate-500 hover:text-slate-700 hover:underline" pendingLabel="…">
                      Restaurer
                    </SubmitButton>
                  </form>
                ) : (
                  <form action={archiveEmailTemplate.bind(null, template.id)}>
                    <SubmitButton className="text-xs font-semibold text-slate-500 hover:text-slate-700 hover:underline" pendingLabel="…">
                      Archiver
                    </SubmitButton>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
        {templates.length === 0 && <p className="text-sm text-slate-500">Aucun modèle pour l&apos;instant.</p>}
      </div>
    </div>
  );
}
