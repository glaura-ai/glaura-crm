"use client";

import { useTransition } from "react";
import { checkSalonDelete, deleteSalon } from "@/lib/actions";

// Admin-only hard delete of a lead. When the lead is tied to a Glaura
// (Firebase) account, the server refuses while that account is enabled, and
// asks for the salon name typed back once it is disabled.
export function DeleteLeadButton({ salonId, salonName, className }: { salonId: string; salonName: string; className?: string }) {
  const [pending, startTransition] = useTransition();

  const onClick = () =>
    startTransition(async () => {
      try {
        const { accounts } = await checkSalonDelete(salonId);
        const active = accounts.filter((a) => !a.disabled);
        if (active.length > 0) {
          window.alert(
            `« ${salonName} » a un compte Glaura actif (${active.map((a) => a.email ?? a.uid).join(", ")}).\n` +
              "Désactive-le dans Firebase avant de supprimer ce lead.",
          );
          return;
        }
        let confirmName: string | undefined;
        if (accounts.length > 0) {
          const typed = window.prompt(
            `« ${salonName} » est lié à un compte Glaura désactivé (${accounts.map((a) => a.email ?? a.uid).join(", ")}).\n` +
              "Le compte Firebase n'est pas supprimé, seulement le lead CRM.\n" +
              `Pour confirmer, saisis le nom du salon : ${salonName}`,
          );
          if (typed === null) return;
          confirmName = typed;
        } else if (
          !window.confirm(
            `Supprimer définitivement « ${salonName} » et tout son historique (activités, rappels, traitements) ? Cette action est irréversible.`,
          )
        ) {
          return;
        }
        await deleteSalon(salonId, confirmName);
      } catch (error) {
        window.alert(error instanceof Error ? error.message : "L'opération a échoué. Réessaie.");
      }
    });

  return (
    <button
      type="button"
      disabled={pending}
      aria-label={`Supprimer ${salonName}`}
      title="Supprimer"
      onClick={onClick}
      className={className ?? "rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"}
    >
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
        <path
          fillRule="evenodd"
          d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482 41.03 41.03 0 0 0-2.365-.298V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4Zm-2.44 12.5a.75.75 0 0 1-.749-.712l-.5-9.5a.75.75 0 0 1 1.498-.078l.5 9.5a.75.75 0 0 1-.75.79Zm5.63-.712a.75.75 0 0 1-1.498-.078l.5-9.5a.75.75 0 0 1 1.498.078l-.5 9.5Z"
          clipRule="evenodd"
        />
      </svg>
    </button>
  );
}
