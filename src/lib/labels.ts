import type { Metier, SalonStatus, SalonType, ActivityType, BookingTool, ProspectSource } from "@/generated/prisma/enums";

export const METIER_LABEL: Record<Metier, string> = {
  COIFFURE: "Coiffure",
  ESTHETIQUE: "Esthétique",
  ONGLES: "Ongles",
  BARBIER: "Barbier",
  SPA: "Spa",
  AUTRE: "Autre",
};

export const STATUS_LABEL: Record<SalonStatus, string> = {
  A_VISITER: "À visiter",
  VISITE_FAITE: "Visite faite",
  INTERESSE: "Intéressé",
  A_RELANCER: "À relancer",
  PAS_INTERESSE: "Pas intéressé",
  SIGNE: "Signé",
};

// Tailwind classes per status (chip bg/text).
export const STATUS_STYLE: Record<SalonStatus, string> = {
  A_VISITER: "bg-slate-100 text-slate-700",
  VISITE_FAITE: "bg-sky-100 text-sky-700",
  INTERESSE: "bg-violet-100 text-violet-700",
  A_RELANCER: "bg-amber-100 text-amber-800",
  PAS_INTERESSE: "bg-rose-100 text-rose-700",
  SIGNE: "bg-emerald-100 text-emerald-700",
};

export const STATUS_ORDER: SalonStatus[] = [
  "A_VISITER",
  "VISITE_FAITE",
  "INTERESSE",
  "A_RELANCER",
  "PAS_INTERESSE",
  "SIGNE",
];

export const METIER_ORDER: Metier[] = ["COIFFURE", "ESTHETIQUE", "ONGLES", "BARBIER", "SPA", "AUTRE"];

export const TYPE_STYLE: Record<SalonType, string> = {
  A: "bg-emerald-500",
  B: "bg-violet-500",
  C: "bg-amber-500",
  D: "bg-slate-400",
};

export const ACTIVITY_LABEL: Record<ActivityType, string> = {
  APPEL: "Appel",
  VISIO: "Visio",
  VISITE: "Visite",
  RELANCE: "Relance",
  EMAIL: "Email",
  DEMO: "Démo",
  NOTE: "Note",
};

export const BOOKING_LABEL: Record<BookingTool, string> = {
  PLANITY: "Planity",
  TREATWELL: "Treatwell",
  ACUITY: "Acuity",
  BOOKSY: "Booksy",
  FRESHA: "Fresha",
  SITE: "Site web",
  NONE: "—",
};

export const PROSPECT_SOURCE_LABEL: Record<ProspectSource, string> = {
  PLANITY: "Planity",
  TREATWELL: "Treatwell",
  BOOKSY: "Booksy",
  FRESHA: "Fresha",
};

export const PROSPECT_SOURCE_STYLE: Record<ProspectSource, string> = {
  PLANITY: "bg-indigo-100 text-indigo-700",
  TREATWELL: "bg-orange-100 text-orange-700",
  BOOKSY: "bg-teal-100 text-teal-700",
  FRESHA: "bg-fuchsia-100 text-fuchsia-700",
};

// accountStatusLabel values that need a rep's attention, surfaced as a chip on
// the salon card. Other labels (self_serve, pro_preview, …) stay detail-only.
export const ACCOUNT_ATTENTION_LABEL: Record<string, string> = {
  signup_started: "Inscription en cours",
  signup_stuck: "Bloqué : vérif Instagram",
  oauth_cancelled: "Bloqué : vérif Instagram",
  identity_review: "Vérif identité requise",
  duplicate_email: "Échec : email déjà utilisé",
  import_failed: "Échec import",
};

export const ACCOUNT_ATTENTION_STYLE: Record<string, string> = {
  signup_started: "bg-sky-100 text-sky-700",
  signup_stuck: "bg-amber-100 text-amber-800",
  oauth_cancelled: "bg-amber-100 text-amber-800",
  identity_review: "bg-amber-100 text-amber-800",
  duplicate_email: "bg-red-100 text-red-700",
  import_failed: "bg-red-100 text-red-700",
};
