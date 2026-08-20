import { describe, it, expect } from "vitest";
import { selectShots } from "./shot-selector";
import type { ImageAnalysis } from "../vision/schema";

let counter = 0;
function analysis(overrides: Partial<ImageAnalysis> = {}): ImageAnalysis {
  counter += 1;
  return {
    imageId: `img-${counter}`,
    roomType: "bedroom",
    confidence: 0.9,
    visualQualityScore: 5,
    marketingValueScore: 5,
    cinematicPotentialScore: 5,
    observedFeatures: [],
    recommendedCameraMotion: "static",
    recommendedDurationSeconds: 3,
    useInReel: true,
    reason: "test fixture",
    ...overrides,
  };
}

describe("selectShots", () => {
  it("excludes images the analysis marked useInReel: false", () => {
    const shots = [
      analysis({ roomType: "exterior", useInReel: true }),
      analysis({ roomType: "kitchen", useInReel: false }),
    ];
    const selected = selectShots(shots);
    expect(selected.some((s) => s.roomType === "kitchen")).toBe(false);
  });

  it("caps repetitive rooms rather than filling the reel with one room type", () => {
    // 8 bedroom photos, all useInReel, nothing else available. Spec's own example:
    // this must NOT become "a reel containing five bedroom shots" — the cap must
    // hold even though that means a shorter reel than the 6-shot target.
    const shots = Array.from({ length: 8 }, () => analysis({ roomType: "bedroom" }));
    const selected = selectShots(shots);
    const bedroomCount = selected.filter((s) => s.roomType === "bedroom").length;
    expect(bedroomCount).toBeLessThanOrEqual(2);
  });

  it("selects between 6 and 10 shots when enough diverse candidates exist", () => {
    const roomTypes: ImageAnalysis["roomType"][] = [
      "exterior",
      "living_room",
      "kitchen",
      "dining_room",
      "bedroom",
      "bathroom",
      "garden",
      "patio",
      "balcony",
      "view",
    ];
    const shots = roomTypes.flatMap((roomType) => [
      analysis({ roomType, visualQualityScore: 9, marketingValueScore: 9, cinematicPotentialScore: 9 }),
      analysis({ roomType, visualQualityScore: 3, marketingValueScore: 3, cinematicPotentialScore: 3 }),
    ]);
    const selected = selectShots(shots);
    expect(selected.length).toBeGreaterThanOrEqual(6);
    expect(selected.length).toBeLessThanOrEqual(10);
  });

  it("prefers higher composite-scored images within the same room type", () => {
    const weak = analysis({
      roomType: "kitchen",
      visualQualityScore: 2,
      marketingValueScore: 2,
      cinematicPotentialScore: 2,
    });
    const strong = analysis({
      roomType: "kitchen",
      visualQualityScore: 9,
      marketingValueScore: 9,
      cinematicPotentialScore: 9,
    });
    const others = Array.from({ length: 6 }, (_, i) =>
      analysis({ roomType: (["exterior", "living_room", "dining_room", "bathroom", "garden", "office"] as const)[i] })
    );
    const selected = selectShots([weak, strong, ...others]);
    expect(selected.find((s) => s.imageId === strong.imageId)).toBeDefined();
  });

  it("orders selected shots into a natural walkthrough sequence (exterior before interior before outdoor)", () => {
    const shots = [
      analysis({ roomType: "garden" }),
      analysis({ roomType: "kitchen" }),
      analysis({ roomType: "exterior" }),
      analysis({ roomType: "bedroom" }),
      analysis({ roomType: "bathroom" }),
      analysis({ roomType: "living_room" }),
    ];
    const selected = selectShots(shots);
    const roomOrder = selected.map((s) => s.roomType);
    expect(roomOrder.indexOf("exterior")).toBeLessThan(roomOrder.indexOf("kitchen"));
    expect(roomOrder.indexOf("kitchen")).toBeLessThan(roomOrder.indexOf("garden"));
  });

  it("never forces a room type that isn't present among the candidates", () => {
    const shots = [analysis({ roomType: "kitchen" }), analysis({ roomType: "bedroom" })];
    const selected = selectShots(shots);
    const roomTypesPresent = new Set(selected.map((s) => s.roomType));
    expect(roomTypesPresent.has("exterior")).toBe(false);
    expect(roomTypesPresent.has("garden")).toBe(false);
  });
});
