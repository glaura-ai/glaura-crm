import { validateInstagram } from "@/lib/prospection/actions";
import { SubmitButton } from "@/components/SubmitButton";

export function InstagramCandidates({ prospectId, candidates }: { prospectId: string; candidates: unknown }) {
  if (!Array.isArray(candidates)) return null;
  const accounts = candidates.filter((c): c is { username: string } => c && typeof c.username === "string" && /^[a-z0-9._]{1,30}$/i.test(c.username));
  if (!accounts.length) return null;
  return <details className="mt-2 min-w-40 text-xs"><summary className="cursor-pointer font-medium text-violet-700">Valider un compte</summary><div className="mt-2 space-y-2">{accounts.map(c => <div key={c.username} className="flex items-center justify-between gap-2"><a href={`https://www.instagram.com/${c.username}`} target="_blank" rel="noreferrer" className="text-violet-700">@{c.username} ↗</a><form action={validateInstagram}><input type="hidden" name="prospectId" value={prospectId} /><input type="hidden" name="username" value={c.username} /><SubmitButton className="text-emerald-700">Confirmer</SubmitButton></form></div>)}</div></details>;
}
