import { describe, it, expect } from "vitest";
import { buildStoryboard } from "./storyboard-builder";
import type { ImageAnalysis } from "../vision/schema";

function analysis(overrides: Partial<ImageAnalysis> = {}): ImageAnalysis {
  return {
    imageId: "img-1",
    roomType: "kitchen",
    confidence: 0.9,
    visualQualityScore: 8,
    marketingValueScore: 8,
    cinematicPotentialScore: 8,
    observedFeatures: [],
    recommendedCameraMotion: "dolly_forward",
    recommendedDurationSeconds: 4,
    useInReel: true,
    reason: "test",
    ...overrides,
  };
}

describe("buildStoryboard", () => {
  it("produces scenes with sequential order starting at 0", () => {
    const scenes = buildStoryboard([
      analysis({ imageId: "a", roomType: "exterior" }),
      analysis({ imageId: "b", roomType: "kitchen" }),
    ]);
    expect(scenes.map((s) => s.order)).toEqual([0, 1]);
  });

  it("every scene starts in 'planned' status (no credits spent yet)", () => {
    const scenes = buildStoryboard([analysis()]);
    expect(scenes.every((s) => s.status === "planned")).toBe(true);
  });

  it("carries imageId, roomType, cameraMotion, and duration through from the analysis", () => {
    const scenes = buildStoryboard([
      analysis({ imageId: "img-42", roomType: "bathroom", recommendedCameraMotion: "pan_left", recommendedDurationSeconds: 5 }),
    ]);
    expect(scenes[0]).toMatchObject({
      imageId: "img-42",
      roomType: "bathroom",
      cameraMotion: "pan_left",
      durationSeconds: 5,
    });
  });

  it("each scene has a non-empty, unique id", () => {
    const scenes = buildStoryboard([analysis({ imageId: "a" }), analysis({ imageId: "b" })]);
    const ids = scenes.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.length > 0)).toBe(true);
  });

  it("populates a real higgsfieldPrompt for each scene", () => {
    const scenes = buildStoryboard([analysis()]);
    expect(scenes[0]!.higgsfieldPrompt.length).toBeGreaterThan(50);
  });
});
