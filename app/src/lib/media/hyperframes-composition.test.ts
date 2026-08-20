import { describe, it, expect } from "vitest";
import { computeTimings, generateComposition } from "./hyperframes-composition";
import type { BrandProfile } from "../brand/types";

describe("computeTimings", () => {
  it("keeps opening and closing windows within the total duration, never overlapping", () => {
    const t = computeTimings(30, false);
    expect(t.openStart).toBeGreaterThanOrEqual(0);
    expect(t.openStart + t.openDuration).toBeLessThanOrEqual(t.closeStart);
    expect(t.closeStart + t.closeDuration).toBeLessThanOrEqual(t.totalSeconds + 0.01);
  });

  it("omits the feature callout window on a short reel with no room for it", () => {
    const t = computeTimings(4, true);
    expect(t.featureStart).toBeNull();
  });

  it("places a feature callout window between opening and closing on a long enough reel", () => {
    const t = computeTimings(30, true);
    expect(t.featureStart).not.toBeNull();
    expect(t.featureStart!).toBeGreaterThanOrEqual(t.openStart + t.openDuration);
    expect(t.featureStart! + t.featureDuration).toBeLessThanOrEqual(t.closeStart);
  });

  it("never produces a feature window when hasFeatureCallout is false, regardless of duration", () => {
    const t = computeTimings(60, false);
    expect(t.featureStart).toBeNull();
  });
});

const BRAND: BrandProfile = {
  companyName: "Apex Marketing Solutions",
  agentName: "Jane Doe",
  phone: "555-0100",
  website: "apex.example",
  primaryColor: "#112233",
  secondaryColor: "#ffffff",
  cta: "Book a viewing",
};

describe("generateComposition", () => {
  it("produces valid HTML referencing the video and audio assets", () => {
    const timings = computeTimings(20, false);
    const html = generateComposition(BRAND, { address: "123 Main St", cityState: "Sioux Falls, SD" }, timings, 1080, 1920);

    expect(html).toContain("assets/reel.mp4");
    expect(html).toContain('<video id="reel-video"');
    expect(html).toContain("<audio");
    expect(html).toContain("vendor/gsap.min.js");
    expect(html).toContain('window.__timelines["main"]');
  });

  it("includes brand colors, agent info, and CTA in the closing card", () => {
    const timings = computeTimings(20, false);
    const html = generateComposition(BRAND, {}, timings, 1080, 1920);

    expect(html).toContain("#112233");
    expect(html).toContain("Apex Marketing Solutions");
    expect(html).toContain("Jane Doe");
    expect(html).toContain("Book a viewing");
  });

  it("HTML-escapes property/brand text to avoid breaking the composition markup", () => {
    const timings = computeTimings(20, false);
    const html = generateComposition(
      { ...BRAND, companyName: '<script>alert(1)</script>' },
      { address: '123 "Quoted" St & Co' },
      timings,
      1080,
      1920
    );

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;");
  });

  it("omits the opening title block entirely when no address/cityState is given", () => {
    const timings = computeTimings(20, false);
    const html = generateComposition(BRAND, {}, timings, 1080, 1920);
    expect(html).not.toContain('id="opening-title"');
  });

  it("includes the feature callout block only when the timing window exists", () => {
    const timingsWithRoom = computeTimings(30, true);
    const withFeature = generateComposition(BRAND, { featureCallout: "open-concept living" }, timingsWithRoom, 1080, 1920);
    expect(withFeature).toContain("OPEN-CONCEPT LIVING");

    const timingsNoRoom = computeTimings(3, true);
    const withoutFeature = generateComposition(BRAND, { featureCallout: "open-concept living" }, timingsNoRoom, 1080, 1920);
    expect(withoutFeature).not.toContain("OPEN-CONCEPT LIVING");
  });

  it("uses the given video dimensions, not a hardcoded size", () => {
    const timings = computeTimings(20, false);
    const html = generateComposition(BRAND, {}, timings, 720, 1280);
    expect(html).toContain('data-width="720"');
    expect(html).toContain('data-height="1280"');
  });
});
