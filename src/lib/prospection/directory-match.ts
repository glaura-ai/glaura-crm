// A postcode or a similar name alone cannot establish that two branches are the same salon.
export type DirectoryIdentity = {
  name: string;
  postalCode: string | null;
  street: string | null;
};

function words(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function normalizeStreet(value: string | null) {
  if (!value) return "";
  return words(value.split(/\b\d{5}\b/)[0])
    .replace(/\b(?:bd|bld|boul)\b/g, "boulevard")
    .replace(/\bav\b/g, "avenue")
    .replace(/\brte\b/g, "route")
    .replace(/\bst\b/g, "saint")
    .replace(/\bste\b/g, "sainte")
    .replace(/(\d+)\s+(bis|ter)\b/g, "$1$2")
    .replace(/\bparis$/, "")
    .replace(/\s+/g, "");
}

const GENERIC = new Set(["l", "le", "la", "les", "de", "d", "du", "des", "et", "and", "salon", "institut", "beaute", "beauty", "coiffure", "coiffeur", "hair", "nails", "spa", "barber", "barbier", "atelier", "paris"]);
function distinctiveName(value: string) {
  return words(value).split(" ").filter(token => token.length > 1 && !GENERIC.has(token) && !/^\d+(?:e|er)?$/.test(token));
}

export function sameDirectoryBusiness(a: DirectoryIdentity, b: DirectoryIdentity) {
  if (!a.postalCode || a.postalCode !== b.postalCode) return false;
  const street = normalizeStreet(a.street);
  // Require a street number and the entire normalized street, not just neighbourhood proximity.
  if (!/^\d+[a-z]/.test(street) || street !== normalizeStreet(b.street)) return false;
  if (words(a.name) === words(b.name)) return true;
  const left = new Set(distinctiveName(a.name));
  const right = new Set(distinctiveName(b.name));
  if (!left.size || !right.size) return false;
  const shared = [...left].filter(token => right.has(token)).length;
  return shared / Math.max(left.size, right.size) >= 0.8;
}

export function intersectDirectories<T extends DirectoryIdentity & { sourceUrl: string }>(treatwell: T[], planity: T[]) {
  const candidates = treatwell.map(t => ({ treatwell: t, matches: planity.filter(p => sameDirectoryBusiness(t, p)) }));
  const usage = new Map<string, number>();
  for (const entry of candidates) for (const p of entry.matches) usage.set(p.sourceUrl, (usage.get(p.sourceUrl) ?? 0) + 1);
  const pairs: { treatwell: T; planity: T }[] = [];
  let ambiguous = 0;
  for (const entry of candidates) {
    if (entry.matches.length === 1 && usage.get(entry.matches[0].sourceUrl) === 1) pairs.push({ treatwell: entry.treatwell, planity: entry.matches[0] });
    else if (entry.matches.length) ambiguous++;
  }
  return { pairs, ambiguous, unmatched: candidates.filter(c => !c.matches.length).length };
}
