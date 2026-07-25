"use client";

import { useFormStatus } from "react-dom";

// A submit button that disables itself while its form is in flight.
//
// Without this a server-action form gives no feedback at all: the page looks
// idle, so an operator waiting on a slow action clicks again, and every click
// is another request. That is how one salon got created 32 times in 74 seconds.
export function SubmitButton({
  children,
  pendingLabel,
  className = "",
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`${className} disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {pending ? (pendingLabel ?? "Enregistrement…") : children}
    </button>
  );
}
