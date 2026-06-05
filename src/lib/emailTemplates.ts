export const EMAIL_TEMPLATES = ["INTRO", "DEMO_FOLLOW_UP", "RELANCE", "SIGNATURE_NEXT_STEPS"] as const;

export type EmailTemplateKey = (typeof EMAIL_TEMPLATES)[number];

export const EMAIL_TEMPLATE_LABEL: Record<EmailTemplateKey, string> = {
  INTRO: "Premier contact",
  DEMO_FOLLOW_UP: "Après démo",
  RELANCE: "Relance",
  SIGNATURE_NEXT_STEPS: "Après signature",
};

export type EmailSalonDraftInput = {
  name: string;
  contactName?: string | null;
  bookingUrl?: string | null;
};

export function buildEmailDraft(template: EmailTemplateKey, salon: EmailSalonDraftInput) {
  const contact = firstName(salon.contactName) || "bonjour";
  const salonName = salon.name;
  const bookingLine = salon.bookingUrl ? `\n\nJ'ai vu votre page de réservation ici : ${salon.bookingUrl}` : "";

  switch (template) {
    case "INTRO":
      return {
        subject: `Glaura pour ${salonName}`,
        body: `Bonjour ${contact},\n\nJe me permets de vous contacter pour ${salonName}. Glaura aide les salons à recevoir plus de réservations et à mieux convertir Instagram, Google et leur site en rendez-vous.\n\nEst-ce que vous seriez disponible cette semaine pour un échange de 10 minutes ?${bookingLine}\n\nBonne journée,\nL'équipe Glaura`,
      };
    case "DEMO_FOLLOW_UP":
      return {
        subject: `Suite à notre démo Glaura`,
        body: `Bonjour ${contact},\n\nMerci pour votre temps. Je vous renvoie les points clés vus ensemble pour ${salonName} : une page de réservation moderne, les services repris automatiquement et un parcours client plus simple.\n\nSouhaitez-vous que je vous prépare le compte pour validation ?\n\nBonne journée,\nL'équipe Glaura`,
      };
    case "SIGNATURE_NEXT_STEPS":
      return {
        subject: `Prochaines étapes pour ${salonName}`,
        body: `Bonjour ${contact},\n\nLe compte Glaura de ${salonName} est en préparation. Je reviens vers vous dès que la première version est prête pour vérification.\n\nNous vérifierons ensemble les services, l'équipe, les horaires et la page de réservation avant activation.\n\nBonne journée,\nL'équipe Glaura`,
      };
    case "RELANCE":
    default:
      return {
        subject: `Relance Glaura - ${salonName}`,
        body: `Bonjour ${contact},\n\nJe me permets de vous relancer au sujet de Glaura pour ${salonName}.\n\nEst-ce que vous souhaitez que l'on cale un court échange pour voir si cela peut vous aider à développer les réservations du salon ?\n\nBonne journée,\nL'équipe Glaura`,
      };
  }
}

function firstName(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0] || null;
}
