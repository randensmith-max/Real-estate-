import type { BrandProfile } from "../brand/types";

export interface ReelBrandingData {
  address?: string;
  cityState?: string;
  price?: string;
  bedrooms?: number;
  bathrooms?: number;
  /** A single restrained callout, e.g. "OPEN-CONCEPT LIVING" — spec: minimal copy, not a list. */
  featureCallout?: string;
}

export interface CompositionTimings {
  totalSeconds: number;
  openStart: number;
  openDuration: number;
  featureStart: number | null;
  featureDuration: number;
  closeStart: number;
  closeDuration: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Scales overlay windows to the reel's actual duration, never overlapping and never overflowing it. */
export function computeTimings(totalSeconds: number, hasFeatureCallout: boolean): CompositionTimings {
  const openDuration = clamp(totalSeconds * 0.18, 1.5, 3);
  const closeDuration = clamp(totalSeconds * 0.18, 2, 4);
  const openStart = 0.3;
  const closeStart = Math.max(openStart + openDuration, totalSeconds - closeDuration);

  const availableForFeature = closeStart - (openStart + openDuration) - 0.6;
  const featureDuration = clamp(totalSeconds * 0.12, 1.2, 2.5);
  const featureStart =
    hasFeatureCallout && availableForFeature > featureDuration
      ? openStart + openDuration + (availableForFeature - featureDuration) / 2
      : null;

  return { totalSeconds, openStart, openDuration, featureStart, featureDuration, closeStart, closeDuration };
}

const FONT_STACK =
  '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/**
 * Generates the HyperFrames composition HTML (Technical spec: premium /
 * modern / cinematic style — large clean typography, minimal copy, subtle
 * gradients, restrained overlays; property footage remains the hero, so
 * overlays are lower-thirds/title cards over the video, never full-screen
 * graphics). Pure function — no filesystem/process access — so it's fully
 * unit-testable independent of the CLI render step.
 */
export function generateComposition(
  brand: BrandProfile,
  data: ReelBrandingData,
  timings: CompositionTimings,
  videoWidth: number,
  videoHeight: number
): string {
  const primary = brand.primaryColor || "#111111";
  const secondary = brand.secondaryColor || "#ffffff";
  const totalDuration = Math.ceil(timings.totalSeconds);

  const bedBath = [
    data.bedrooms ? `${data.bedrooms} BED` : null,
    data.bathrooms ? `${data.bathrooms} BATH` : null,
  ]
    .filter(Boolean)
    .join(" &middot; ");

  const featureBlock =
    timings.featureStart !== null && data.featureCallout
      ? `
      <div id="feature" class="clip lower-third" data-start="${timings.featureStart}" data-duration="${timings.featureDuration}" data-track-index="2">
        <span class="feature-text">${escapeHtml(data.featureCallout.toUpperCase())}</span>
      </div>`
      : "";

  const logoBlock = brand.logoPath
    ? `<img class="brand-logo" src="assets/logo${brand.logoPath.slice(brand.logoPath.lastIndexOf("."))}" alt="" />`
    : "";

  const closingLines = [brand.companyName, brand.agentName, brand.phone, brand.website]
    .filter(Boolean)
    .map((line) => `<div class="closing-line">${escapeHtml(String(line))}</div>`)
    .join("\n        ");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${videoWidth}, height=${videoHeight}" />
    <script src="vendor/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${videoWidth}px; height: ${videoHeight}px; overflow: hidden; background: #000; }
      body { font-family: ${FONT_STACK}; }
      #reel-video { width: ${videoWidth}px; height: ${videoHeight}px; object-fit: cover; }
      .clip { position: absolute; }
      .scrim {
        position: absolute; inset: 0;
        background: linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0) 40%);
        pointer-events: none;
      }
      #opening-title {
        left: 6%; bottom: 20%; right: 6%;
        color: ${secondary}; font-size: 64px; font-weight: 700; line-height: 1.15;
        text-shadow: 0 4px 24px rgba(0,0,0,0.55);
      }
      #opening-title .city-state {
        display: block; font-size: 32px; font-weight: 400; opacity: 0.9; margin-top: 6px;
      }
      #price-card {
        left: 6%; bottom: 8%;
        display: flex; align-items: center; gap: 20px;
        background: rgba(15,20,28,0.72); border: 1px solid rgba(255,255,255,0.18);
        border-radius: 14px; padding: 16px 26px; color: ${secondary};
      }
      #price-card .price { font-size: 36px; font-weight: 700; }
      #price-card .divider { width: 1px; height: 30px; background: rgba(255,255,255,0.3); }
      #price-card .beds-baths { font-size: 22px; opacity: 0.9; }
      .lower-third {
        left: 6%; bottom: 10%;
        background: ${primary}; color: ${secondary};
        padding: 14px 24px; border-radius: 10px;
      }
      .feature-text { font-size: 28px; font-weight: 700; letter-spacing: 1px; }
      #closing-card {
        inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
        background: ${primary}; color: ${secondary}; gap: 12px; text-align: center;
      }
      .brand-logo { max-width: 40%; max-height: 120px; margin-bottom: 8px; }
      .closing-line { font-size: 28px; }
      #closing-card .cta {
        margin-top: 16px; font-size: 32px; font-weight: 700;
        border: 2px solid ${secondary}; padding: 12px 32px; border-radius: 999px;
      }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="${totalDuration}"
      data-width="${videoWidth}"
      data-height="${videoHeight}"
    >
      <video id="reel-video" class="clip" muted data-start="0" data-duration="${totalDuration}" data-track-index="0" src="assets/reel.mp4"></video>
      <audio class="clip" data-start="0" data-duration="${totalDuration}" data-track-index="0" src="assets/reel.mp4"></audio>

      <div class="scrim clip" data-start="0" data-duration="${totalDuration}" data-track-index="1"></div>

      ${data.address || data.cityState
        ? `<div id="opening-title" class="clip" data-start="${timings.openStart}" data-duration="${timings.openDuration}" data-track-index="2">
        ${data.address ? escapeHtml(data.address) : ""}
        ${data.cityState ? `<span class="city-state">${escapeHtml(data.cityState)}</span>` : ""}
      </div>`
        : ""}

      ${data.price || bedBath
        ? `<div id="price-card" class="clip" data-start="${timings.openStart + 0.3}" data-duration="${Math.max(0.3, timings.openDuration - 0.3)}" data-track-index="2">
        ${data.price ? `<span class="price">${escapeHtml(data.price)}</span>` : ""}
        ${data.price && bedBath ? `<span class="divider"></span>` : ""}
        ${bedBath ? `<span class="beds-baths">${bedBath}</span>` : ""}
      </div>`
        : ""}

      ${featureBlock}

      <div id="closing-card" class="clip" data-start="${timings.closeStart}" data-duration="${timings.closeDuration}" data-track-index="3">
        ${logoBlock}
        ${closingLines}
        ${brand.cta ? `<div class="cta">${escapeHtml(brand.cta)}</div>` : ""}
      </div>
    </div>

    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });

      ${data.address || data.cityState ? `tl.from("#opening-title", { opacity: 0, y: 30, duration: 0.5 }, ${timings.openStart});` : ""}
      ${data.price || bedBath ? `tl.from("#price-card", { opacity: 0, y: 20, duration: 0.5 }, ${timings.openStart + 0.3});` : ""}
      tl.to("#opening-title, #price-card", { opacity: 0, duration: 0.35 }, ${(timings.openStart + timings.openDuration - 0.35).toFixed(2)});
      ${timings.featureStart !== null ? `tl.from("#feature", { opacity: 0, y: 16, duration: 0.4 }, ${timings.featureStart});
      tl.to("#feature", { opacity: 0, duration: 0.35 }, ${(timings.featureStart + timings.featureDuration - 0.35).toFixed(2)});` : ""}
      tl.from("#closing-card", { opacity: 0, duration: 0.5 }, ${timings.closeStart});

      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
