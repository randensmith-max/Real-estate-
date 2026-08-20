import { z } from "zod";

export const ROOM_TYPES = [
  "exterior",
  "living_room",
  "kitchen",
  "dining_room",
  "bedroom",
  "bathroom",
  "office",
  "hallway",
  "garage",
  "garden",
  "patio",
  "balcony",
  "view",
  "other",
] as const;

export const CAMERA_MOTIONS = [
  "push_in",
  "pull_back",
  "pan_left",
  "pan_right",
  "dolly_forward",
  "subtle_parallax",
  "gentle_orbit",
  "static",
] as const;

/**
 * Structured per-image analysis (spec exact shape). `zod` enforces this at
 * the API boundary — Claude's response is validated, never trusted as
 * free-form text (Technical Plan §20 principle, still followed under the
 * simplified plan).
 */
export const ImageAnalysisSchema = z.object({
  imageId: z.string(),
  roomType: z.enum(ROOM_TYPES),
  confidence: z.number().min(0).max(1),
  visualQualityScore: z.number().min(0).max(10),
  marketingValueScore: z.number().min(0).max(10),
  cinematicPotentialScore: z.number().min(0).max(10),
  observedFeatures: z.array(z.string()),
  recommendedCameraMotion: z.enum(CAMERA_MOTIONS),
  recommendedDurationSeconds: z.number().min(1).max(10),
  useInReel: z.boolean(),
  reason: z.string(),
});

export type ImageAnalysis = z.infer<typeof ImageAnalysisSchema>;
