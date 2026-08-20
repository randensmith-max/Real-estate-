// sampleA: actual analysis of scripts/poc/hyperframes-test/assets/sample-property.jpg
// produced by this Claude session reading the real image file (multimodal Read tool),
// NOT via a standalone Anthropic Messages API HTTP call (no ANTHROPIC_API_KEY in this
// sandbox — see Phase 0 report). This is the one real image available in-session; it is
// a synthetic ffmpeg-generated gradient placeholder, not a photograph. The value of this
// sample is that it proves the model reports "cannot determine" rather than inventing a
// room, which is the exact anti-hallucination behavior Technical Plan §18 requires.
export const sampleA_realImageAnalysis = {
  imageId: "poc-sample-property-jpg",
  roomType: "unknown",
  roomConfidence: 0.02,
  visualQualityScore: 1,
  marketingValueScore: 0,
  compositionQuality: "poor",
  observedFeatures: [
    {
      claim: "Image is a smooth dark blue-to-black diagonal gradient with no furniture, architecture, or discernible objects.",
      evidenceType: "OBSERVED_FACT",
    },
  ],
  possibleIssues: [
    "Image does not depict a real property photograph — appears to be a synthetic test/placeholder graphic.",
    "No room type, features, or marketing claims can be responsibly derived from this image.",
  ],
  recommendedUse: "exclude",
  motionRecommendation: "none",
};

// sampleB: worked example of the OBSERVED / LISTING-PROVIDED / INFERENCE / MARKETING
// classification rule (Technical Plan §18), using a hypothetical kitchen photo + a
// hypothetical listing description, to prove the classification logic independent of
// whatever image is available in this sandbox. Model behavior (not yet verified against
// a live API call) is represented here as the intended/target output shape.
export const sampleB_evidenceClassificationWorkedExample = {
  imageId: "poc-hypothetical-kitchen",
  roomType: "kitchen",
  roomConfidence: 0.94,
  visualQualityScore: 8,
  marketingValueScore: 7.5,
  compositionQuality: "good",
  observedFeatures: [
    {
      claim: "Kitchen has light-coloured (cream/white) cabinetry and a light-toned worktop.",
      evidenceType: "OBSERVED_FACT", // visible directly in the image
    },
    {
      claim: "Listing text states the kitchen was 'fitted in 2022'.",
      evidenceType: "LISTING_PROVIDED_FACT", // from listing copy, not visible in the photo
    },
    {
      claim: "Recently renovated kitchen.",
      evidenceType: "MARKETING_INTERPRETATION", // NOT acceptable to state as fact per §18 unless listing explicitly says "renovated" (it says "fitted", not "renovated" — this is flagged, not asserted)
    },
    {
      claim: "Likely a family-oriented household given the breakfast-bar layout.",
      evidenceType: "INFERENCE", // a plausible but unverifiable inference, must not be stated as fact
    },
  ],
  possibleIssues: [],
  recommendedUse: "secondary",
  motionRecommendation: "slow_push_in",
};

// sampleC: intentionally invalid payload for schema-rejection test.
// - roomType uses a value not in the enum ("man_cave")
// - marketingValueScore is out of the 0-10 range (15)
// - roomConfidence is out of the 0-1 range (1.4)
// - missing required field `possibleIssues`
export const sampleC_invalidPayload = {
  imageId: "poc-invalid-test",
  roomType: "man_cave",
  roomConfidence: 1.4,
  visualQualityScore: 8,
  marketingValueScore: 15,
  compositionQuality: "good",
  observedFeatures: [],
  recommendedUse: "hero",
  motionRecommendation: "dolly",
};
