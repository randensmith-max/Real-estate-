import { describe, it, expect } from "vitest";
import { ImageAnalysisSchema } from "./schema";

const validAnalysis = {
  imageId: "/api/images/proj-1/abc.jpg",
  roomType: "kitchen",
  confidence: 0.92,
  visualQualityScore: 8,
  marketingValueScore: 7,
  cinematicPotentialScore: 8,
  observedFeatures: ["light cabinetry", "island seating"],
  recommendedCameraMotion: "dolly_forward",
  recommendedDurationSeconds: 4,
  useInReel: true,
  reason: "Bright, spacious kitchen with strong visual clarity.",
};

describe("ImageAnalysisSchema", () => {
  it("accepts a well-formed analysis", () => {
    expect(ImageAnalysisSchema.safeParse(validAnalysis).success).toBe(true);
  });

  it("rejects an invalid roomType", () => {
    const result = ImageAnalysisSchema.safeParse({ ...validAnalysis, roomType: "man_cave" });
    expect(result.success).toBe(false);
  });

  it("rejects confidence outside 0-1", () => {
    expect(ImageAnalysisSchema.safeParse({ ...validAnalysis, confidence: 1.5 }).success).toBe(false);
  });

  it("rejects visualQualityScore outside 0-10", () => {
    expect(ImageAnalysisSchema.safeParse({ ...validAnalysis, visualQualityScore: 15 }).success).toBe(false);
  });

  it("rejects an invalid recommendedCameraMotion", () => {
    expect(
      ImageAnalysisSchema.safeParse({ ...validAnalysis, recommendedCameraMotion: "spin_wildly" }).success
    ).toBe(false);
  });

  it("rejects a missing required field", () => {
    const { reason: _reason, ...withoutReason } = validAnalysis;
    expect(ImageAnalysisSchema.safeParse(withoutReason).success).toBe(false);
  });
});
