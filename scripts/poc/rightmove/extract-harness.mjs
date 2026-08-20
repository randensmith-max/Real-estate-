// Phase 0E PoC harness — structure only, NOT executed against a live listing.
// Status: BLOCKED_BY_INPUT (no Rightmove URL supplied) AND separately confirmed
// BLOCKED by this sandbox's network egress policy (rightmove.co.uk itself is
// unreachable here — see network-check.mjs). Both facts are recorded in the
// Phase 0 report. This file proves the intended extraction structure compiles
// and follows the plan's preference order (§11); it has not been run against
// real Rightmove HTML.
import { chromium } from "playwright";

const PREFERENCE_ORDER = [
  "embedded_structured_data", // e.g. a __NEXT_DATA__ / JSON-LD script tag
  "semantic_accessible_data", // aria-labelled / role-based regions
  "stable_attributes", // data-testid or similar stable hooks, if present
  "dom_fallback", // last resort: generated CSS class selectors
];

async function handleCookieConsent(page) {
  // Real listings commonly show a consent banner (OneTrust or similar) before
  // content is interactive. Best-effort click on a common accept-button pattern;
  // must not fail extraction if no banner appears.
  const candidates = [
    'button:has-text("Accept all")',
    'button:has-text("Accept")',
    '#onetrust-accept-btn-handler',
  ];
  for (const selector of candidates) {
    const el = page.locator(selector).first();
    if (await el.count().catch(() => 0)) {
      await el.click({ timeout: 3000 }).catch(() => {});
      break;
    }
  }
}

async function extractEmbeddedStructuredData(page) {
  // Preference 1: look for a JSON blob the page itself uses to hydrate the UI.
  // Exact script tag id/shape is unknown without a live page and must be
  // confirmed once a real listing URL is available (this is the primary
  // unresolved unknown blocking full completion of this PoC).
  return page.evaluate(() => {
    const nextData = document.querySelector("#__NEXT_DATA__");
    if (nextData) {
      try {
        return { source: "__NEXT_DATA__", data: JSON.parse(nextData.textContent) };
      } catch {
        /* fall through */
      }
    }
    const jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(
      (el) => {
        try {
          return JSON.parse(el.textContent);
        } catch {
          return null;
        }
      }
    ).filter(Boolean);
    if (jsonLd.length) return { source: "json-ld", data: jsonLd };
    return null;
  });
}

function detectRemovedListing(pageContent) {
  const removalMarkers = [
    "no longer available",
    "this property is no longer",
    "sorry, we could not find",
  ];
  const lower = pageContent.toLowerCase();
  return removalMarkers.some((m) => lower.includes(m));
}

export async function extractListing(url) {
  if (!url) {
    return { status: "BLOCKED_BY_INPUT", reason: "No Rightmove URL supplied for Phase 0E." };
  }

  const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  });
  const page = await browser.newPage();

  try {
    const response = await page.goto(url, { timeout: 20000, waitUntil: "domcontentloaded" });
    await handleCookieConsent(page);

    const bodyText = await page.evaluate(() => document.body.innerText);
    if (detectRemovedListing(bodyText)) {
      return { status: "REMOVED_LISTING", url };
    }

    const structured = await extractEmbeddedStructuredData(page);

    await page.screenshot({ path: "diagnostic-screenshot.png", fullPage: false });

    return {
      status: response?.ok() ? "OK" : "HTTP_ERROR",
      httpStatus: response?.status(),
      extractionMethod: structured ? structured.source : "UNRESOLVED — no embedded structured data found, DOM fallback required",
      preferenceOrderFollowed: PREFERENCE_ORDER,
      // Individual fields (address, price, bedrooms, etc.) intentionally NOT
      // implemented yet — mapping from real page structure to these fields
      // requires a live page to inspect and is explicitly out of scope until
      // Decision 2 (Rightmove usage authorization) and a real URL are provided.
    };
  } catch (err) {
    return { status: "NAVIGATION_FAILED", error: err.message };
  } finally {
    await browser.close();
  }
}

// CLI entry point for manual testing once a URL + network access are available.
const url = process.argv[2];
const result = await extractListing(url);
console.log(JSON.stringify(result, null, 2));
