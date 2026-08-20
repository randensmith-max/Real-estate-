import { chromium } from "playwright";

const sites = [
  "https://www.zillow.com/",
  "https://www.realtor.com/",
  "https://www.redfin.com/",
  "https://www.rightmove.co.uk/",
];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
for (const url of sites) {
  const page = await browser.newPage();
  try {
    const resp = await page.goto(url, { timeout: 15000, waitUntil: "domcontentloaded" });
    console.log(`${url} -> STATUS ${resp?.status()}, title="${(await page.title()).slice(0, 60)}"`);
  } catch (err) {
    console.log(`${url} -> FAILED: ${err.message.split("\n")[0]}`);
  } finally {
    await page.close();
  }
}
await browser.close();
