/**
 * Unit tests for the PURE credential-authorization predicate
 * (src/lib/onboarding-access.ts).
 *
 * Usage: npx tsx scripts/onboard-access-test.ts
 *
 * No test framework — plain assertions, exits non-zero on any failure so it
 * can gate CI. This rule decides who gets to see a live Firebase password, and
 * authentication is the entire gate, so the deny cases are what matter: every
 * shape of "not really signed in" must stay out of the decrypt path.
 */

import { canRevealOnboardingPassword } from "../src/lib/onboarding-access";

let failures = 0;

function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${label}`);
  }
}

check("admin can reveal", canRevealOnboardingPassword({ id: "u-admin", role: "ADMIN" }));
check("assigned commercial can reveal", canRevealOnboardingPassword({ id: "u-owner", role: "COMMERCIAL" }));
check(
  "any other signed-in commercial can reveal — not scoped to the assigned rep",
  canRevealOnboardingPassword({ id: "u-other", role: "COMMERCIAL" }),
);
check("an unknown role still counts as signed in", canRevealOnboardingPassword({ id: "u-x", role: "SOMETHING" }));
check("a missing role still counts as signed in", canRevealOnboardingPassword({ id: "u-x" }));

check("anonymous viewer cannot reveal", !canRevealOnboardingPassword(null));
check("undefined viewer cannot reveal", !canRevealOnboardingPassword(undefined));
check("viewer without an id cannot reveal", !canRevealOnboardingPassword({ role: "ADMIN" }));
check("viewer with a null id cannot reveal", !canRevealOnboardingPassword({ id: null, role: "ADMIN" }));
check("viewer with a blank id cannot reveal", !canRevealOnboardingPassword({ id: "", role: "ADMIN" }));

console.log("");
if (failures > 0) {
  console.error(`${failures} test(s) FAILED`);
  process.exit(1);
} else {
  console.log("All tests passed.");
}
