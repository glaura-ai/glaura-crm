#!/usr/bin/env node
// Post-onboarding completeness guardrail. Reads the userProfile + services that
// an onboarding run created and checks for the gaps that silently produce a
// broken-but-"successful" salon (the all-"Fermé" hours bug being the trigger).
// Findings are merged into the result file's `warnings[]` (which the CRM already
// surfaces) plus a `completeness` object, so an incomplete profile can't pass as
// "Compte préparé" unnoticed.
//
// Must be run with firebase-admin resolvable (i.e. from goglow-firebase/functions):
//   cd goglow-firebase/functions && node <path>/validate-profile.mjs <uid> <resultPath>
// Never throws the job into failure — it only annotates the result file.

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

// Resolve firebase-admin from the CURRENT WORKING DIRECTORY (the runner invokes
// this from goglow-firebase/functions), not from this script's own location.
const require = createRequire(join(process.cwd(), "noop.cjs"));

const uid = process.argv[2];
const resultPath = process.argv[3];
if (!uid || !resultPath) {
  console.error("usage: validate-profile.mjs <uid> <resultPath>");
  process.exit(2);
}

const DAY_KEYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function validTiming(timing, days) {
  if (!timing || typeof timing !== "object") return false;
  if (!Array.isArray(days) || days.length === 0) return false;
  // Every open day must have a non-empty [open, close] pair.
  return days.every((d) => {
    const v = timing[DAY_KEYS[d]];
    return Array.isArray(v) && v.length === 2 && Number(v[0]) > 0 && Number(v[1]) > 0;
  });
}

async function main() {
  const admin = require("firebase-admin");
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();

  const snap = await db.collection("userProfile").doc(uid).get();
  const missing = [];
  const soft = [];

  if (!snap.exists) {
    missing.push("userProfile document not found");
  } else {
    const p = snap.data() || {};
    if (!(p.companyName || p.name)) missing.push("salon name (companyName)");
    if (!p.address) missing.push("address");
    if (!p.spLocation || !p.spLocation.geometry) missing.push("location/coordinates (spLocation)");
    if (!validTiming(p.timing, p.days)) missing.push("opening hours (timing/days)");

    const services = await db.collection("services").where("ownerId", "==", uid).limit(1).get();
    if (services.empty) missing.push("at least one service");

    if (!p.phone) soft.push("phone");
    if (!p.profileImg && !(Array.isArray(p.salon_images) && p.salon_images.length)) soft.push("profile image / salon photos");
    if (!p.insta) soft.push("instagram handle");
  }

  const complete = missing.length === 0;

  // Merge into the result file (best-effort; never break the run).
  try {
    const result = JSON.parse(readFileSync(resultPath, "utf8"));
    const warnings = Array.isArray(result.warnings) ? [...result.warnings] : [];
    if (missing.length) warnings.push(`Profil incomplet — champs requis manquants: ${missing.join(", ")}`);
    if (soft.length) warnings.push(`Profil — champs optionnels manquants: ${soft.join(", ")}`);
    const merged = { ...result, completeness: { complete, missing, soft }, warnings: [...new Set(warnings)] };
    writeFileSync(resultPath, JSON.stringify(merged, null, 2), "utf8");
  } catch (err) {
    console.error("validate-profile: could not patch result file:", err.message);
  }

  console.error(`validate-profile: ${complete ? "COMPLETE" : "INCOMPLETE — missing: " + missing.join(", ")}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("validate-profile error:", err.message);
  process.exit(0); // never fail the job on a validator error
});
