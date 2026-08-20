import { describe, it, expect, vi, beforeEach } from "vitest";

const uploadImageMock = vi.fn();
const subscribeMock = vi.fn();

vi.mock("@higgsfield/client", () => {
  class MockAPIError extends Error {
    statusCode?: number;
    constructor(message: string, statusCode?: number) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  class MockAuthenticationError extends MockAPIError {}
  class MockNotEnoughCreditsError extends MockAPIError {
    constructor() {
      super("Not enough credits", 403);
    }
  }
  class MockHiggsfieldClient {
    uploadImage = uploadImageMock;
  }
  return {
    HiggsfieldClient: MockHiggsfieldClient,
    APIError: MockAPIError,
    AuthenticationError: MockAuthenticationError,
    NotEnoughCreditsError: MockNotEnoughCreditsError,
  };
});

vi.mock("@higgsfield/client/v2", () => ({
  createHiggsfieldClient: vi.fn(() => ({ subscribe: subscribeMock })),
}));

const { HiggsfieldProvider } = await import("./higgsfield-provider");
const { VideoGenerationError } = await import("./provider");
const { NotEnoughCreditsError } = await import("@higgsfield/client");

const testInput = {
  sourceImageBuffer: Buffer.from("fake-image-bytes"),
  sourceImageFormat: "jpeg" as const,
  prompt: "test prompt",
};

describe("HiggsfieldProvider", () => {
  beforeEach(() => {
    uploadImageMock.mockReset();
    subscribeMock.mockReset();
  });

  it("throws immediately if constructed without credentials", () => {
    expect(() => new HiggsfieldProvider("")).toThrow(VideoGenerationError);
  });

  it("throws if credentials are not in KEY_ID:KEY_SECRET format", () => {
    expect(() => new HiggsfieldProvider("not-a-valid-credential")).toThrow(VideoGenerationError);
  });

  it("uploads the source image, then subscribes, and caches the completed result", async () => {
    uploadImageMock.mockResolvedValueOnce("https://cdn.higgsfield.ai/uploaded.jpg");
    subscribeMock.mockResolvedValueOnce({
      status: "completed",
      request_id: "req-1",
      status_url: "https://platform.higgsfield.ai/requests/req-1/status",
      cancel_url: "https://platform.higgsfield.ai/requests/req-1/cancel",
      video: { url: "https://cdn.higgsfield.ai/req-1.mp4" },
    });

    const provider = new HiggsfieldProvider("id:secret");
    const job = await provider.generateScene(testInput);

    expect(job.providerJobId).toBe("req-1");
    expect(uploadImageMock).toHaveBeenCalledWith(testInput.sourceImageBuffer, "jpeg");
    expect(subscribeMock).toHaveBeenCalledWith(
      "/v1/image2video/dop",
      expect.objectContaining({
        input: expect.objectContaining({
          prompt: "test prompt",
          input_images: [{ type: "image_url", image_url: "https://cdn.higgsfield.ai/uploaded.jpg" }],
        }),
        withPolling: true,
      })
    );

    const status = await provider.getJobStatus(job.providerJobId);
    expect(status).toEqual({ status: "completed" });
  });

  it("getJobStatus throws for an unknown job id (never fabricates status)", async () => {
    const provider = new HiggsfieldProvider("id:secret");
    await expect(provider.getJobStatus("never-submitted")).rejects.toBeInstanceOf(VideoGenerationError);
  });

  it("maps a failed generation to status 'failed'", async () => {
    uploadImageMock.mockResolvedValueOnce("https://cdn.higgsfield.ai/uploaded.jpg");
    subscribeMock.mockResolvedValueOnce({
      status: "failed",
      request_id: "req-2",
      status_url: "x",
      cancel_url: "x",
    });

    const provider = new HiggsfieldProvider("id:secret");
    const job = await provider.generateScene(testInput);
    const status = await provider.getJobStatus(job.providerJobId);
    expect(status.status).toBe("failed");
  });

  it("maps an nsfw rejection to status 'nsfw' rather than throwing", async () => {
    uploadImageMock.mockResolvedValueOnce("https://cdn.higgsfield.ai/uploaded.jpg");
    subscribeMock.mockResolvedValueOnce({ status: "nsfw", request_id: "req-3", status_url: "x", cancel_url: "x" });

    const provider = new HiggsfieldProvider("id:secret");
    const job = await provider.generateScene(testInput);
    const status = await provider.getJobStatus(job.providerJobId);
    expect(status.status).toBe("nsfw");
  });

  it("wraps NotEnoughCreditsError as a non-retryable VideoGenerationError", async () => {
    uploadImageMock.mockResolvedValueOnce("https://cdn.higgsfield.ai/uploaded.jpg");
    subscribeMock.mockRejectedValueOnce(new NotEnoughCreditsError());

    const provider = new HiggsfieldProvider("id:secret");
    await expect(provider.generateScene(testInput)).rejects.toMatchObject({
      name: "VideoGenerationError",
      retryable: false,
    });
  });

  it("downloadResult refuses to download a non-completed job", async () => {
    uploadImageMock.mockResolvedValueOnce("https://cdn.higgsfield.ai/uploaded.jpg");
    subscribeMock.mockResolvedValueOnce({ status: "failed", request_id: "req-4", status_url: "x", cancel_url: "x" });

    const provider = new HiggsfieldProvider("id:secret");
    const job = await provider.generateScene(testInput);
    await expect(provider.downloadResult(job.providerJobId)).rejects.toBeInstanceOf(VideoGenerationError);
  });
});
