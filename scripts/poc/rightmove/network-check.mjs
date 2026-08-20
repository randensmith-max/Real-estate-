import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage();
try {
  const resp = await page.goto("https://www.rightmove.co.uk/", { timeout: 20000, waitUntil: "domcontentloaded" });
  console.log("STATUS:", resp?.status());
  console.log("TITLE:", await page.title());
} catch (err) {
  console.log("NAVIGATION FAILED:", err.message);
} finally {
  await browser.close();
}
