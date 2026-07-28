"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { revealOnboardingPassword } from "@/lib/actions";

// How long a revealed password stays on screen before masking itself again.
// Long enough to read it down the phone, short enough that an unlocked laptop
// on a salon counter isn't showing a live credential ten minutes later.
const AUTO_HIDE_MS = 60_000;

const MASK = "••••••••••";

/**
 * Masked display of an onboarded account's password with an explicit reveal.
 *
 * The ciphertext never reaches the browser: this renders dots until the
 * operator clicks, then fetches the plaintext through a server action that
 * re-checks authorization and writes an audit event. Nothing is persisted
 * client-side — a refresh puts it back behind the mask.
 */
export function OnboardingPasswordReveal({ jobId }: { jobId: string }) {
  const [password, setPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const hide = useCallback(() => {
    setPassword(null);
    setError(null);
    setCopied(false);
  }, []);

  // Re-arms on every reveal; clears on unmount so a navigation mid-countdown
  // doesn't leave a timer pointing at an unmounted component.
  useEffect(() => {
    if (!password) return;
    const timer = setTimeout(hide, AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [password, hide]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  function reveal() {
    setError(null);
    startTransition(async () => {
      const result = await revealOnboardingPassword(jobId);
      if (result.ok) setPassword(result.password);
      else setError(result.error);
    });
  }

  async function copy() {
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      // Clipboard access is blocked outside a secure context — the password is
      // on screen anyway, so say so rather than failing silently.
      setError("Copie impossible — sélectionne le mot de passe à la main");
    }
  }

  return (
    <div className="mt-1">
      <div className="flex items-center gap-2">
        <code className="font-mono text-xs text-slate-700" aria-live="polite">
          {password ?? MASK}
        </code>

        {password ? (
          <>
            <button
              type="button"
              onClick={copy}
              className="text-xs font-semibold text-rose-600 hover:text-rose-700 hover:underline"
            >
              {copied ? "Copié" : "Copier"}
            </button>
            <button
              type="button"
              onClick={hide}
              className="text-xs font-semibold text-slate-500 hover:text-slate-700 hover:underline"
            >
              Masquer
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={reveal}
            disabled={pending}
            aria-busy={pending}
            className="text-xs font-semibold text-rose-600 hover:text-rose-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
          >
            {pending ? "Déchiffrement…" : "Afficher"}
          </button>
        )}
      </div>

      {error && <p className="mt-1 text-xs text-rose-700">{error}</p>}
    </div>
  );
}
