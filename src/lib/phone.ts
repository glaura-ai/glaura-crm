// Phone numbers reach us from Airtable in whatever shape the salon typed them:
// "0142712982", "01 42 72 31 99", "+33665349052" and — thanks to a spreadsheet
// text-forcing artifact — "'+33665349052". Searching them therefore needs both
// sides reduced to one canonical form first.

const MIN_SEARCHABLE_DIGITS = 4;

/**
 * Reduces a free-form phone number to its French national form: digits only,
 * international prefixes rewritten to the leading 0 (+33 6 65 34 90 52 →
 * 0665349052). Anything that isn't a digit is dropped, so separators, the
 * apostrophe artifact and "Tel:" prefixes all disappear.
 *
 * Returns "" when the input carries no digits.
 */
export function canonicalizePhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (digits.startsWith("0033")) return `0${digits.slice(4)}`;
  if (digits.startsWith("33") && digits.length === 11) return `0${digits.slice(2)}`;
  return digits;
}

/**
 * Canonicalizes a user's search term, but only when it plausibly *is* a phone
 * number — a query needs at least {@link MIN_SEARCHABLE_DIGITS} digits before
 * we run it against phone numbers, so that searching "Sarah 06" or a street
 * number doesn't drag in every salon in the 6th.
 *
 * Returns null when the term shouldn't be treated as a phone search.
 */
export function phoneSearchTerm(q: string): string | null {
  const canonical = canonicalizePhone(q);
  return canonical.length >= MIN_SEARCHABLE_DIGITS ? canonical : null;
}
