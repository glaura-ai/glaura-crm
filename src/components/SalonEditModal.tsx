"use client";

import { useEffect, useId, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SalonForm, type SalonFormValues } from "@/components/SalonForm";
import { cn } from "@/lib/utils";

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("a,button,input,select,textarea,label"));
}

export function SalonEditModal({
  action,
  salon,
  children,
  className,
}: {
  action: (fd: FormData) => Promise<void>;
  salon: SalonFormValues;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function openFromPointer(event: MouseEvent<HTMLDivElement>) {
    if (isInteractiveTarget(event.target)) return;
    setOpen(true);
  }

  function openFromKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (isInteractiveTarget(event.target)) return;
    event.preventDefault();
    setOpen(true);
  }

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-label="Modifier les informations du salon"
        onClick={openFromPointer}
        onKeyDown={openFromKeyboard}
        className={cn("outline-none focus-visible:ring-2 focus-visible:ring-rose-300", className)}
      >
        {children}
      </div>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/35 px-4 py-10"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              className="w-full max-w-3xl rounded-xl border border-slate-300 bg-white shadow-xl"
            >
              <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
                <div>
                  <h2 id={titleId} className="text-lg font-semibold text-slate-950">Modifier le salon</h2>
                  <p className="mt-0.5 text-sm text-slate-500">{salon.name}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Fermer
                </button>
              </div>
              <div className="px-6 py-5">
                <SalonForm action={action} salon={salon} />
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
