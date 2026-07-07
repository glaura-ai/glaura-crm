/**
 * Lazy firebase-admin singleton for the `beauty-984c8` Firebase project.
 *
 * IMPORTANT — import safety: this module MUST NOT initialize firebase-admin
 * (or touch Auth/Firestore) at import/build time. Next.js's build step
 * imports lib modules to type-check/bundle them, and this repo's local dev
 * environment has no Firebase credentials at all — a top-level
 * `initializeApp()` would throw during `next build`/`tsc` and would risk
 * accidentally touching the PROD project. Initialization only happens the
 * first time one of the getters below is actually called at runtime.
 *
 * Credentials: Application Default Credentials (ADC) — set
 * `GOOGLE_APPLICATION_CREDENTIALS` to a service-account JSON path (or rely on
 * workload identity when running on GCP). Never hardcode credentials here.
 */

import { applicationDefault, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth as getAuthForApp, type Auth } from "firebase-admin/auth";
import { getFirestore as getFirestoreForApp, type Firestore } from "firebase-admin/firestore";
import { getStorage as getStorageForApp } from "firebase-admin/storage";

/**
 * EU user-media bucket the apps now read/write salon + profile images from
 * (see the goglow apps' `user_media_storage.dart` → `gs://glaura-user-media-eu`).
 * Onboarding must upload here — the legacy US `beauty-984c8.appspot.com` bucket
 * is the old convention that predates the EU media migration.
 */
export const MEDIA_BUCKET = "glaura-user-media-eu";

let cachedApp: App | null = null;

/** Returns the singleton firebase-admin App, initializing it from ADC on first call. */
export function getAdmin(): App {
  if (cachedApp) return cachedApp;
  // Reuse an app initialized elsewhere in the process (e.g. by a test/host
  // harness) instead of throwing on double-initialization.
  cachedApp = getApps()[0] ?? initializeApp({ credential: applicationDefault() });
  return cachedApp;
}

/** Firebase Auth client for the `beauty-984c8` project. */
export function getAuth(): Auth {
  return getAuthForApp(getAdmin());
}

/** Firestore client for the `beauty-984c8` project. */
export function getDb(): Firestore {
  return getFirestoreForApp(getAdmin());
}

/** The EU user-media bucket ([MEDIA_BUCKET]) for salon/profile image uploads. */
export function getMediaBucket() {
  return getStorageForApp(getAdmin()).bucket(MEDIA_BUCKET);
}
