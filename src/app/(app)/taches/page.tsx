import { randomUUID } from "node:crypto";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { completeReminder } from "@/lib/actions";
import { requireMember, prospectScope } from "@/lib/access";
import { createSalesTask, finishSalesTask } from "@/lib/task-actions";
import { getAssignableUsers } from "@/lib/salons";
import { SubmitButton } from "@/components/SubmitButton";
import { frenchDate, parisDateInput } from "@/lib/crm-format";
const input = "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm";
const button = "rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700";

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireMember();
  const admin = user.role === "ADMIN";
  const sp = await searchParams;
  const done = sp.view === "done";
  const owner = admin ? sp.owner : user.id;
  const page = Math.max(1, Math.min(100000, Number.parseInt(sp.page ?? "", 10) || 1));
  const where = { ...(owner ? { assignedToId: owner } : {}), doneAt: done ? { not: null } : null };
  const [tasks, total, users, prospect, salon, reminders] = await Promise.all([
    prisma.salesTask.findMany({ where, orderBy: [{ dueAt: "asc" }, { id: "asc" }], take: 50, skip: (page - 1) * 50, select: { id: true, title: true, context: true, dueAt: true, doneAt: true, outcome: true, assignedTo: { select: { name: true, email: true } }, prospect: { select: { id: true, name: true } }, salon: { select: { id: true, name: true } } } }),
    prisma.salesTask.count({ where }), admin ? getAssignableUsers() : Promise.resolve([]),
    sp.prospect ? prisma.prospect.findFirst({ where: { id: sp.prospect, ...prospectScope(user) }, include: { tournee: true } }) : null,
    sp.salon ? prisma.salon.findFirst({ where: { id: sp.salon, ...(admin ? {} : { assignedToId: user.id }) } }) : null,
    done ? Promise.resolve([]) : prisma.reminder.findMany({ where: { done: false, ...(owner ? { userId: owner } : {}), salon: { archivedAt: null, ...(!admin ? { assignedToId: user.id } : {}) } }, orderBy: { dueAt: "asc" }, take: 50, include: { salon: { select: { id: true, name: true } } } }),
  ]);
  const initialOwner = prospect?.assignedToId ?? prospect?.tournee?.assignedToId ?? salon?.assignedToId ?? user.id;
  const href = (nextPage: number) => { const qs = new URLSearchParams(); if (owner) qs.set("owner", owner); if (done) qs.set("view", "done"); qs.set("page", String(nextPage)); return `/taches?${qs}`; };
  return <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8"><header><p className="text-sm font-medium text-rose-600">Chaque prospect, une prochaine action</p><h1 className="mt-1 text-3xl font-semibold text-slate-950">{admin ? "Tâches commerciales" : "Mes tâches"}</h1><p className="mt-2 text-sm text-slate-500">Les tâches restent ici jusqu’à leur réalisation, même après leur échéance.</p></header>
    {sp.error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-800">{sp.error}</p>}
    <details open={!!prospect || !!salon} className="rounded-xl border border-slate-200 bg-white p-5"><summary className="cursor-pointer font-semibold text-slate-900">Créer une tâche{prospect || salon ? ` · ${prospect?.name ?? salon?.name}` : ""}</summary><form action={createSalesTask} className="mt-4 grid gap-4 md:grid-cols-2"><input type="hidden" name="requestKey" value={randomUUID()} /><label className="text-sm">Action à réaliser<input name="title" required maxLength={200} placeholder="Appeler pour proposer une démonstration" className={`${input} mt-1 w-full`} /></label><label className="text-sm">Échéance<input name="dueAt" type="date" required defaultValue={parisDateInput()} className={`${input} mt-1 w-full`} /></label>{admin ? <label className="text-sm">Responsable<select name="assignedToId" required defaultValue={initialOwner} className={`${input} mt-1 w-full`}>{users.map(u => <option key={u.id} value={u.id}>{u.name ?? u.email}</option>)}</select></label> : <input type="hidden" name="assignedToId" value={user.id} />}<label className="text-sm md:col-span-2">Contexte partagé avec le commercial<textarea name="context" maxLength={4000} rows={3} className={`${input} mt-1 w-full`} /></label>{prospect && <input type="hidden" name="prospectId" value={prospect.id} />}{salon && <input type="hidden" name="salonId" value={salon.id} />}<div><SubmitButton className={button}>Créer la tâche</SubmitButton></div></form></details>
    <form className="flex flex-wrap gap-3"><select aria-label="État des tâches" name="view" defaultValue={done ? "done" : "open"} className={input}><option value="open">À réaliser</option><option value="done">Terminées</option></select>{admin && <select aria-label="Responsable des tâches" name="owner" defaultValue={owner ?? ""} className={input}><option value="">Toute l’équipe</option>{users.map(u => <option key={u.id} value={u.id}>{u.name ?? u.email}</option>)}</select>}<button className={input}>Afficher</button><span className="self-center text-sm text-slate-500">{total} tâche(s)</span></form>
    {reminders.length > 0 && <section className="rounded-xl border border-amber-200 bg-amber-50 p-5"><h2 className="font-semibold text-slate-950">Rappels déjà planifiés</h2><div className="mt-3 divide-y divide-amber-100">{reminders.map(r => <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="text-sm font-medium">{r.title}</p><Link href={`/salons/${r.salon.id}`} className="text-xs text-rose-700">{r.salon.name} · {frenchDate(r.dueAt, true)}</Link></div><form action={async () => { "use server"; await completeReminder(r.id, r.salon.id); }}><SubmitButton className={input}>Terminer le rappel</SubmitButton></form></div>)}</div></section>}
    <div className="space-y-3">{tasks.map(t => {
      const late = !t.doneAt && t.dueAt < new Date();
      return <article key={t.id} className={`rounded-xl border bg-white p-5 ${late ? "border-amber-300" : "border-slate-200"}`}><div className="flex flex-wrap justify-between gap-3"><div><h2 className="font-semibold text-slate-950">{t.title}</h2><p className="mt-1 text-sm text-slate-500">{t.assignedTo.name ?? t.assignedTo.email} · {late ? "En retard · " : ""}{frenchDate(t.dueAt)}</p>{t.salon ? <Link href={`/salons/${t.salon.id}`} className="mt-2 inline-block text-sm text-rose-700">{t.salon.name} →</Link> : t.prospect && <Link href={`/prospection?q=${encodeURIComponent(t.prospect.name)}`} className="mt-2 inline-block text-sm text-rose-700">{t.prospect.name} →</Link>}</div>{t.doneAt && <span className="text-sm text-emerald-700">Terminée le {frenchDate(t.doneAt)}</span>}</div>{t.context && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600">{t.context}</p>}{t.outcome && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{t.outcome}</p>}{!t.doneAt && <form action={finishSalesTask} className="mt-4 flex flex-wrap gap-2"><input type="hidden" name="id" value={t.id} /><input name="outcome" required maxLength={4000} aria-label="Résultat de l’action" placeholder="Résultat de l’action…" className={`${input} min-w-60 flex-1`} /><SubmitButton className={button}>Marquer comme terminée</SubmitButton></form>}</article>;
    })}{!tasks.length && <p className="rounded-xl border border-dashed p-12 text-center text-slate-500">Aucune tâche dans cette vue.</p>}</div><div className="flex justify-between text-sm"><span>Page {page} sur {Math.max(1, Math.ceil(total / 50))}</span><div className="flex gap-4">{page > 1 && <Link href={href(page - 1)}>Précédent</Link>}{page * 50 < total && <Link href={href(page + 1)}>Suivant</Link>}</div></div>
  </div>;
}
