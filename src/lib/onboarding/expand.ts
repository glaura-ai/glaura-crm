/**
 * Deterministic Playwright "expander" for salon booking pages.
 *
 * This is a plain TS module (no Next.js imports) so it can run from a CLI
 * script or a worker. It replaces the manual click sequence a Claude Code
 * CLI onboarding agent used to perform by hand:
 *   - dismiss the cookie-consent banner
 *   - click every "Voir les ... autres prestations" / accordion expander
 *     until the page has revealed all of its hidden content
 *   - best-effort reveal staff/team assignment
 *
 * The result is the fully-expanded page HTML, ready for a downstream parser
 * to extract services/hours/address/name deterministically (no LLM).
 */

import { chromium, type Browser, type Page } from "playwright";

export type SourceType = "planity" | "treatwell" | "acuity" | "generic";

export type ExpandResult = {
  sourceType: SourceType;
  url: string;
  title: string;
  html: string;
};

export type ExpandOptions = {
  /** Overall wall-clock budget for the whole expansion, including browser launch. */
  timeoutMs?: number;
  /** Defaults to true; expose for local debugging with a visible browser. */
  headless?: boolean;
};

const DEFAULT_TIMEOUT_MS = 60_000;
const NAV_TIMEOUT_MS = 30_000;
const ACTION_TIMEOUT_MS = 15_000;
const CLICK_TIMEOUT_MS = 3_000;
const CLICK_SETTLE_MS = 400;
const MAX_EXPANDER_ITERATIONS = 30;

const TREATWELL_COLLECTOR_ID = "glaura-expanded-services";

/**
 * Detects the booking-page source from the URL host, per the onboarding
 * headless policy (Step 0 of onboard-headless.md).
 */
export function detectSource(url: string): SourceType {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "generic";
  }

  if (host.includes("planity.com")) return "planity";
  if (host.includes("treatwell.")) return "treatwell";
  if (host.includes("acuityscheduling.com") || host.endsWith(".as.me")) return "acuity";
  return "generic";
}

/**
 * Best-effort cookie-consent dismissal across the known providers:
 * - Treatwell uses OneTrust with a stable button id.
 * - Planity uses Didomi with a "Continuer sans accepter" button.
 * Falls back to a handful of generic French consent labels for other sources.
 * Any failure here is non-fatal — the expander proceeds regardless.
 */
async function dismissCookieBanner(page: Page): Promise<void> {
  try {
    const oneTrust = page.locator("#onetrust-accept-btn-handler");
    if (await oneTrust.count()) {
      await oneTrust.first().click({ timeout: CLICK_TIMEOUT_MS });
      await page.waitForTimeout(CLICK_SETTLE_MS);
      return;
    }
  } catch {
    // ignore and fall through to text-based candidates
  }

  const dismissTexts = [
    "Continuer sans accepter",
    "Autoriser tous les cookies",
    "Tout accepter",
    "Accepter tout",
    "J'accepte",
    "Accepter",
  ];

  for (const text of dismissTexts) {
    try {
      const btn = page.locator("button:visible", { hasText: text }).first();
      if (await btn.count()) {
        await btn.click({ timeout: CLICK_TIMEOUT_MS });
        await page.waitForTimeout(CLICK_SETTLE_MS);
        return;
      }
    } catch {
      // best-effort: try the next candidate
    }
  }
}

// Matches Planity's "Voir les X autres prestations" expanders, plus generic
// "voir plus / voir tout" accordion toggles used by other booking sites.
const EXPANDER_TEXT_PATTERN = /voir\s+.*autres?\s+prestations?/i;
const EXPANDER_FALLBACK_PATTERN = /^voir\s+(tout|plus)\b/i;

/** Opens native <details> accordions directly — no click needed. */
async function openNativeAccordions(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll("details:not([open])").forEach((d) => d.setAttribute("open", ""));
  });
}

/**
 * Repeatedly finds and clicks every visible "expander" button/link
 * (e.g. Planity's "Voir les 9 autres prestations") until none remain,
 * capped at `maxIterations`. Individual click failures are ignored so one
 * flaky element never blocks the rest of the expansion.
 */
async function clickAllExpanders(page: Page, maxIterations = MAX_EXPANDER_ITERATIONS): Promise<number> {
  let totalClicks = 0;

  for (let i = 0; i < maxIterations; i++) {
    await openNativeAccordions(page).catch(() => {});

    const candidates = await page.locator("button:visible, a:visible, [role=button]:visible").all();
    let clickedThisPass = false;

    for (const el of candidates) {
      let text = "";
      try {
        text = ((await el.textContent()) ?? "").trim();
      } catch {
        continue;
      }
      if (!text) continue;
      if (!EXPANDER_TEXT_PATTERN.test(text) && !EXPANDER_FALLBACK_PATTERN.test(text)) continue;

      try {
        await el.click({ timeout: CLICK_TIMEOUT_MS });
        totalClicks++;
        clickedThisPass = true;
        await page.waitForTimeout(CLICK_SETTLE_MS);
        break; // the DOM likely changed; re-query candidates from scratch
      } catch {
        // ignore this element's click failure, try the next candidate
      }
    }

    if (!clickedThisPass) break;
  }

  return totalClicks;
}

/**
 * Treatwell renders its service categories as single-select tabs (e.g. "Tout",
 * "Massage", "Épilation") that *replace* the visible service list rather than
 * accumulating it — clicking through them alone would leave only the last
 * category's services in the final HTML. To make the returned document a
 * superset of everything the page can show, clone each category's service
 * nodes into a hidden collector element as we click through every tab.
 */
async function expandTreatwellCategories(page: Page): Promise<void> {
  await page.evaluate((collectorId) => {
    if (!document.getElementById(collectorId)) {
      const collector = document.createElement("div");
      collector.id = collectorId;
      collector.setAttribute("data-glaura-collected-services", "true");
      collector.style.display = "none";
      document.body.appendChild(collector);
    }
  }, TREATWELL_COLLECTOR_ID);

  const collectCurrentServices = async () => {
    await page
      .evaluate((collectorId) => {
        const collector = document.getElementById(collectorId);
        if (!collector) return;
        const seen = new Set(
          Array.from(collector.children).map((c) => c.getAttribute("data-glaura-name") ?? ""),
        );
        document.querySelectorAll('[class*="MenuItem-module--title"]').forEach((el) => {
          if (collector.contains(el)) return;
          const name = (el.textContent ?? "").trim();
          if (!name || seen.has(name)) return;
          seen.add(name);
          const clone = el.cloneNode(true) as HTMLElement;
          clone.setAttribute("data-glaura-name", name);
          collector.appendChild(clone);
        });
      }, TREATWELL_COLLECTOR_ID)
      .catch(() => {
        // best-effort: a failed collection pass just means fewer services captured
      });
  };

  // Capture whatever is shown by default (usually a curated "Tout" subset).
  await collectCurrentServices();

  const tabs = page.locator('[class*="TreatmentTypeButton-module--name"]');
  const tabCount = await tabs.count().catch(() => 0);

  for (let i = 0; i < tabCount; i++) {
    try {
      await tabs.nth(i).click({ timeout: CLICK_TIMEOUT_MS });
    } catch {
      continue; // best-effort; skip this tab and keep going
    }
    await page.waitForTimeout(CLICK_SETTLE_MS);
    await collectCurrentServices();
  }
}

/**
 * Best-effort staff reveal: Planity shows agent assignment behind a
 * "Choisir" button on each service. Clicking one is enough to surface the
 * staff-selection panel in the returned HTML; failures are non-fatal.
 */
async function revealStaffBestEffort(page: Page): Promise<void> {
  try {
    const chooseBtn = page.locator("button:visible", { hasText: "Choisir" }).first();
    if (await chooseBtn.count()) {
      await chooseBtn.click({ timeout: CLICK_TIMEOUT_MS });
      await page.waitForTimeout(CLICK_SETTLE_MS);
    }
  } catch {
    // staff reveal is best-effort only; never fail the expansion for it
  }
}

async function withOverallTimeout<T>(work: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runExpansion(browser: Browser, url: string, sourceType: SourceType): Promise<ExpandResult> {
  const page = await browser.newPage();
  page.setDefaultTimeout(ACTION_TIMEOUT_MS);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  await page.waitForTimeout(1_500); // let client-side rendering settle

  await dismissCookieBanner(page).catch(() => {});

  switch (sourceType) {
    case "planity":
      await clickAllExpanders(page).catch(() => {});
      break;
    case "treatwell":
      await clickAllExpanders(page).catch(() => {});
      await expandTreatwellCategories(page).catch(() => {});
      break;
    case "acuity":
    case "generic":
      // TODO: Acuity and generic booking sites have no expansion logic yet —
      // this is a basic no-expansion fallback (navigate + return HTML as-is).
      // Add source-specific accordion/expander handling here as new sources
      // are onboarded.
      break;
  }

  const title = await page.title().catch(() => "");
  const html = await page.evaluate(() => document.documentElement.outerHTML);

  // Best-effort staff reveal happens *after* capturing the service-listing
  // HTML above: on Planity, clicking "Choisir" navigates the single-page app
  // to a separate booking-calendar view, replacing the whole page content.
  // Running it last means a successful or failed reveal can never corrupt
  // the service listing we already captured.
  await revealStaffBestEffort(page).catch(() => {});

  return { sourceType, url, title, html };
}

/**
 * Launches headless Chromium, navigates to `url`, expands all hidden
 * service/accordion content deterministically, and returns the fully
 * expanded page HTML. Always closes the browser, even on error or timeout.
 */
export async function expandSalonPage(url: string, opts: ExpandOptions = {}): Promise<ExpandResult> {
  const sourceType = detectSource(url);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const headless = opts.headless ?? true;

  // In the Docker image we install chromium via apk (Playwright's own bundled
  // download is skipped by `npm ci --ignore-scripts`) and point Playwright at
  // it with PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH. Locally the env is unset, so
  // Playwright uses its bundled browser. When running against a system chromium
  // inside a container we also need --no-sandbox (non-root user, no user
  // namespaces) and --disable-dev-shm-usage (small /dev/shm).
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim() || undefined;
  const browser = await chromium.launch({
    headless,
    executablePath,
    args: executablePath ? ["--no-sandbox", "--disable-dev-shm-usage"] : undefined,
  });
  try {
    return await withOverallTimeout(runExpansion(browser, url, sourceType), timeoutMs, "expandSalonPage");
  } finally {
    await browser.close().catch(() => {});
  }
}
