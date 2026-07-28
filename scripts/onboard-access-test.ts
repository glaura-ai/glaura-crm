/**
 * Unit tests for the PURE credential-authorization predicates
 * (src/lib/onboarding-access.ts).
 *
 * Usage: npx tsx scripts/onboard-access-test.ts
 *
 * No test framework — plain assertions, exits non-zero on any failure so it
 * can gate CI. These rules decide who gets to see a live Firebase password,
 * so the deny cases matter more than the allow ones.
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

const admin = { id: "u-admin", role: "ADMIN" };
const owner = { id: "u-owner", role: "COMMERCIAL" };
const other = { id: "u-other", role: "COMMERCIAL" };

const assigned = { assignedToId: "u-owner" };
const unassigned = { assignedToId: null };

check("admin can reveal an assigned salon", canRevealOnboardingPassword(admin, assigned));
check("admin can reveal an unassigned salon", canRevealOnboardingPassword(admin, unassigned));
check("assigned commercial can reveal", canRevealOnboardingPassword(owner, assigned));

check("a different commercial cannot reveal", !canRevealOnboardingPassword(other, assigned));
check("commercial cannot reveal an unassigned salon", !canRevealOnboardingPassword(owner, unassigned));
check("anonymous viewer cannot reveal", !canRevealOnboardingPassword(null, assigned));
check("undefined viewer cannot reveal", !canRevealOnboardingPassword(undefined, assigned));
check("viewer without an id cannot reveal", !canRevealOnboardingPassword({ role: "ADMIN" }, assigned));
check("viewer with a blank id cannot reveal", !canRevealOnboardingPassword({ id: "", role: "ADMIN" }, assigned));

// Guards against a null-vs-null match granting access to everyone.
check(
  "null assignedToId never matches a null-ish viewer id",
  !canRevealOnboardingPassword({ id: null, role: "COMMERCIAL" }, unassigned),
);

console.log("");
if (failures > 0) {
  console.error(`${failures} test(s) FAILED`);
  process.exit(1);
} else {
  console.log("All tests passed.");
}
