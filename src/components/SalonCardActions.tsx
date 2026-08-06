"use client";

import { useTransition } from "react";
import { archiveSalon, deleteSalon } from "@/lib/actions";

// Hover-revealed card toolbar (always visible on touch screens, where hover
// doesn't exist). Sits above the card's full-surface <Link> overlay via z-10.
export function SalonCardActions({
  salonId,
  salonName,
  canDelete,
}: {
  salonId: string;
  salonName: string;
  canDelete: boolean;
}) {
  const [pending, startTransition] = useTransition();

  const run = (message: string, action: () => Promise<void>) => {
    if (!window.confirm(message)) return;
    startTransition(async () => {
      try {
        await action();
      } catch (error) {
        window.alert(error instanceof Error ? error.message : "L'opération a échoué. Réessayez.");
      }
    });
  };

  return (
    <div
      className={
        "absolute bottom-3 right-3 z-10 flex items-center gap-1 rounded-lg bg-white/95 opacity-0 shadow-sm ring-1 ring-slate-200 transition " +
        "focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
      }
    >
      <button
        type="button"
        disabled={pending}
        aria-label={`Archiver ${salonName}`}
        title="Archiver"
        onClick={() =>
          run(`Archiver « ${salonName} » ? Il disparaîtra du pipeline.`, () => archiveSalon(salonId))
        }
        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
          <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h13A1.5 1.5 0 0 1 18 4.5v1A1.5 1.5 0 0 1 16.5 7h-13A1.5 1.5 0 0 1 2 5.5v-1Z" />
          <path
            fillRule="evenodd"
            d="M3 8.5h14V15a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8.5Zm4.5 2.25a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1-.75-.75Z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {canDelete && (
        <button
          type="button"
          disabled={pending}
          aria-label={`Supprimer ${salonName}`}
          title="Supprimer"
          onClick={() =>
            run(
              `Supprimer définitivement « ${salonName} » et tout son historique (activités, rappels, jobs) ? Cette action est irréversible.`,
              () => deleteSalon(salonId),
            )
          }
          className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
            <path
              fillRule="evenodd"
              d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482 41.03 41.03 0 0 0-2.365-.298V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4Zm-2.44 12.5a.75.75 0 0 1-.749-.712l-.5-9.5a.75.75 0 0 1 1.498-.078l.5 9.5a.75.75 0 0 1-.75.79Zm5.63-.712a.75.75 0 0 1-1.498-.078l.5-9.5a.75.75 0 0 1 1.498.078l-.5 9.5Z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
