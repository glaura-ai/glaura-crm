import type { Qualification, QualificationMessage } from "./qualification";
const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[’']/g, " ").replace(/[-–—]/g, " ").replace(/\s+/g, " ").trim();
export function revalidateOldInterest(result: Qualification, message: QualificationMessage, now: Date): Qualification {
  if (now.getTime() - message.sentAt.getTime() > 30 * 86400000 && ["CHAUD", "TIEDE"].includes(result.temperature)) return { temperature: "A_RECONTACTER", reason: "Le dernier message entrant date de plus de 30 jours. L’intérêt actuel doit être confirmé.", action: "Vérifier l’intérêt actuel du salon avant de proposer une prochaine étape", confidence: "LOW" };
  return result;
}
export function classifyLeadLocally(latest: QualificationMessage, context: QualificationMessage[], now = new Date()): Qualification {
  if (!latest.incoming) throw new Error("Un message entrant est nécessaire.");
  const text = normalize(latest.text);
  let result: Qualification;
  if (/^\[|^$/.test(text)) result = { temperature: "A_RECONTACTER", reason: "Le message ne contient pas de texte exploitable. Une vérification humaine est nécessaire.", action: "Vérifier le dernier message dans Instagram", confidence: "LOW" };
  else if (/\b(?:non merci|pas (?:du tout )?interess|plus interess|pas besoin|ne (?:me|nous) (?:re)?contact\w* plus|ne (?:souhaite|souhaitons|veux|voulons) (?:pas|plus)|merci de ne plus|arretez de (?:me|nous)|stop (?:message|contact))/.test(text)) result = { temperature: "FROID", reason: "Le dernier message exprime un refus ou demande l’arrêt des sollicitations.", action: "Respecter le refus du salon et clôturer la prospection", confidence: "HIGH" };
  else if (/\b(?:reponse automatique|message automatique|accuse de reception|votre message a bien ete recu|nous (?:avons|vous) (?:bien recu|repondrons))/.test(text)) result = { temperature: "A_RECONTACTER", reason: "Il s’agit d’un accusé de réception ou d’une réponse automatique, sans intérêt commercial confirmé.", action: "Attendre une réponse personnelle avant de qualifier l’intérêt", confidence: "HIGH" };
  else if (/\b(?:plus tard|pas (?:le |pour le )?moment|pas disponible|pas dispo|indisponible|recontact\w* (?:moi|nous|en|dans|a partir)|reven\w* vers (?:moi|nous)|rappel\w* (?:moi|nous) (?:en|dans|la semaine|le mois))/.test(text)) result = { temperature: "A_RECONTACTER", reason: "Le contact demande de différer l’échange ou indique une indisponibilité.", action: "Planifier une relance à la période indiquée par le contact", confidence: "HIGH" };
  else {
    const interest = /\b(?:interess\w*|ravie? d en savoir|volontiers)\b/.test(text);
    const commitment = /\b(?:pouv\w*|pourr\w*).{0,35}\b(?:prevoir|planifier|organiser|faire|avoir|voir).{0,25}\b(?:demo\w*|rendez vous|essai)|\b(?:souhait\w*|voudr\w*|veux|aimer\w*).{0,60}\b(?:demo\w*|rendez vous|rdv|essai|tester|echanger|discuter)|\bquand (?:pourr\w*|pouv\w*|peut).{0,70}\b(?:echang\w*|discut\w*|appel\w*|demo\w*|rencontr\w*)|\b(?:propos\w*|organis\w*|planifi\w*).{0,35}\b(?:creneau\w*|demo\w*|rendez vous)|\bdisponible pour.{0,30}\b(?:demo\w*|rendez vous|echanger)/.test(text);
    const previous = context.filter(m => !m.incoming).at(-1);
    const acceptsProposal = /^(?:oui|avec plaisir|volontiers|d accord|ok)[ !.,]*$/.test(text) && previous && /\b(?:demo\w*|rendez vous|echanger|creneau\w*)\b/.test(normalize(previous.text));
    if (commitment || acceptsProposal || (interest && /\b(?:creneau\w*|disponibilit\w*|quand|rendez vous|rdv)\b/.test(text))) result = { temperature: "CHAUD", reason: "Le contact propose ou accepte une prochaine étape concrète : échange, rendez-vous ou démonstration.", action: "Proposer deux créneaux pour un échange ou une démonstration", confidence: "HIGH" };
    else if (interest || /\b(?:tarifs?|prix|combien|fonctionnalites?|informations?|comment (?:fonctionne|ca marche)|en savoir (?:plus|davantage)|plus de (?:details|precisions))\b/.test(text)) result = { temperature: "TIEDE", reason: "Le contact exprime un intérêt ou demande des informations, sans prochaine étape convenue.", action: "Répondre aux questions et proposer une courte présentation", confidence: "MEDIUM" };
    else result = { temperature: "A_RECONTACTER", reason: "Le dernier message ne donne pas assez d’éléments pour confirmer l’intérêt ou un refus.", action: "Vérifier manuellement l’intention du contact avant de relancer", confidence: "LOW" };
  }
  return revalidateOldInterest(result, latest, now);
}
