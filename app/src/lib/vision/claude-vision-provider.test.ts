import { describe, it, expect, vi, beforeEach } from "vitest";

const createMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  class MockAPIError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  class MockAnthropic {
    messages = { create: createMock };
    static APIError = MockAPIError;
  }
  return { default: MockAnthropic };
});

const { ClaudeVisionProvider } = await import("./claude-vision-provider");
const { VisionAnalysisError } = await import("./provider");

function toolUseResponse(input: Record<string, unknown>) {
  return { content: [{ type: "tool_use", name: "record_image_analysis", input }] };
}

const VALID_INPUT = {
  roomType: "kitchen",
  confidence: 0.9,
  visualQualityScore: 8,
  marketingValueScore: 7,
  cinematicPotentialScore: 8,
  observedFeatures: ["island", "pendant lighting"],
  recommendedCameraMotion: "dolly_forward",
  recommendedDurationSeconds: 4,
  useInReel: true,
  reason: "Bright, spacious kitchen.",
};

const testInput = {
  imageId: "img-1",
  imageBuffer: Buffer.from("fake-bytes"),
  mimeType: "image/jpeg" as const,
  listingContext: {},
};

describe("ClaudeVisionProvider", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it("throws immediately if constructed without an API key", () => {
    expect(() => new ClaudeVisionProvider("")).toThrow(VisionAnalysisError);
  });

  it("returns validated analysis on a well-formed first response (no retry needed)", async () => {
    createMock.mockResolvedValueOnce(toolUseResponse(VALID_INPUT));
    const provider = new ClaudeVisionProvider("fake-key");

    const result = await provider.analyzeImage(testInput);

    expect(result.roomType).toBe("kitchen");
    expect(result.imageId).toBe("img-1");
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("repairs once on an invalid first response, then succeeds on the second attempt", async () => {
    createMock
      .mockResolvedValueOnce(toolUseResponse({ ...VALID_INPUT, roomType: "man_cave" })) // invalid enum
      .mockResolvedValueOnce(toolUseResponse(VALID_INPUT));
    const provider = new ClaudeVisionProvider("fake-key");

    const result = await provider.analyzeImage(testInput);

    expect(result.roomType).toBe("kitchen");
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("throws VisionAnalysisError if both attempts fail schema validation", async () => {
    createMock
      .mockResolvedValueOnce(toolUseResponse({ ...VALID_INPUT, roomType: "man_cave" }))
      .mockResolvedValueOnce(toolUseResponse({ ...VALID_INPUT, confidence: 5 })); // out of range
    const provider = new ClaudeVisionProvider("fake-key");

    await expect(provider.analyzeImage(testInput)).rejects.toBeInstanceOf(VisionAnalysisError);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("wraps a transport/API error as a non-retryable VisionAnalysisError by default", async () => {
    createMock.mockRejectedValueOnce(new Error("network exploded"));
    const provider = new ClaudeVisionProvider("fake-key");

    await expect(provider.analyzeImage(testInput)).rejects.toBeInstanceOf(VisionAnalysisError);
  });

  it("always includes the imageId from the input, overriding anything the model returns", async () => {
    createMock.mockResolvedValueOnce(toolUseResponse({ ...VALID_INPUT, imageId: "model-made-this-up" }));
    const provider = new ClaudeVisionProvider("fake-key");

    const result = await provider.analyzeImage({ ...testInput, imageId: "real-image-id" });
    expect(result.imageId).toBe("real-image-id");
  });
});
