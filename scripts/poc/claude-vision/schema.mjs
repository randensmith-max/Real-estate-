import { z } from "zod";

// Mirrors Technical Plan §17 (image-level analysis fields) and §18
// (observed / listing-provided / inference / interpretation classification).
export const ImageAnalysisSchema = z.object({
  imageId: z.string(),
  roomType: z.enum([
    "exterior",
    "entrance",
    "living_room",
    "kitchen",
    "dining_room",
    "bedroom",
    "bathroom",
    "garden",
    "patio",
    "balcony",
    "garage",
    "office",
    "utility",
    "hallway",
    "view",
    "floorplan",
    "unknown",
    "other",
  ]),
  roomConfidence: z.number().min(0).max(1),
  visualQualityScore: z.number().min(0).max(10),
  marketingValueScore: z.number().min(0).max(10),
  compositionQuality: z.enum(["poor", "fair", "good", "excellent"]),
  observedFeatures: z.array(
    z.object({
      claim: z.string(),
      evidenceType: z.enum([
        "OBSERVED_FACT",
        "LISTING_PROVIDED_FACT",
        "INFERENCE",
        "MARKETING_INTERPRETATION",
      ]),
    })
  ),
  possibleIssues: z.array(z.string()),
  recommendedUse: z.enum(["hero", "secondary", "supporting", "exclude"]),
  motionRecommendation: z.enum([
    "slow_push_in",
    "slow_pull_back",
    "pan_left",
    "pan_right",
    "dolly",
    "orbit",
    "tilt",
    "static",
    "none",
  ]),
});
