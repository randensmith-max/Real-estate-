export interface GenerateSceneInput {
  sourceImageBuffer: Buffer;
  sourceImageFormat: "jpeg" | "png" | "webp";
  prompt: string;
}

export interface ProviderJob {
  providerJobId: string;
}

export type ProviderJobStatus =
  | { status: "queued" | "in_progress" }
  | { status: "completed" }
  | { status: "failed"; reason: string }
  | { status: "nsfw"; reason: string };

export interface GeneratedVideo {
  buffer: Buffer;
  contentType: string;
}

export class VideoGenerationError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "VideoGenerationError";
  }
}

/**
 * Domain contract for image-to-video generation. No Higgsfield-specific
 * detail (SDK method names, DoP model ids, request/response shapes)
 * belongs here — `HiggsfieldProvider` implements this.
 */
export interface VideoGenerationProvider {
  generateScene(input: GenerateSceneInput): Promise<ProviderJob>;
  getJobStatus(jobId: string): Promise<ProviderJobStatus>;
  downloadResult(jobId: string): Promise<GeneratedVideo>;
}
