// Only numbers the contact typed in the DM (consent basis), never Salon.phone.
const MOBILE = /(?<![\d+])(?:(?:\+|00)33[\s.-]*(?:\(0\)[\s.-]*)?|0)([67](?:[\s.-]*\d{2}){4})(?![\s.-]?\d)/g;

/** `texts` oldest first; the latest number of the latest message wins. */
export function extractFrenchMobile(texts: string[]): string | null {
  for (let i = texts.length - 1; i >= 0; i--) {
    const all = [...texts[i].matchAll(MOBILE)];
    if (all.length) return `+33${all[all.length - 1][1].replace(/\D/g, "")}`;
  }
  return null;
}
