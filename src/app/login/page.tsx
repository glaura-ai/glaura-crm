import { signIn } from "@/auth";

export default function LoginPage() {
  const isDev = process.env.NODE_ENV !== "production";
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-rose-500 text-xl font-bold text-white">G</div>
          <h1 className="text-xl font-semibold text-slate-900">Glaura CRM</h1>
          <p className="mt-1 text-sm text-slate-500">Outil commercial interne</p>
        </div>

        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/salons" });
          }}
        >
          <button className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800">
            Continuer avec Google
          </button>
        </form>

        {isDev && (
          <form
            action={async () => {
              "use server";
              await signIn("dev", { redirectTo: "/salons" });
            }}
          >
            <button className="mt-3 w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
              Connexion dev
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-xs text-slate-400">Accès réservé aux comptes @glaura.fr</p>
      </div>
    </main>
  );
}
