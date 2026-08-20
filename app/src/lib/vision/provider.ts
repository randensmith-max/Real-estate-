import type { ImageAnalysis } from "./schema";

export interface VisionAnalysisInput {
  imageId: string;
  imageBuffer: Buffer;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  /** Only verified listing facts — never used by the model to invent unobserved details. */
  listingContext: {
    description?: string;
    keyFeatures?: string[];
    propertyType?: string;
  };
}

export class VisionAnalysisError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "VisionAnalysisError";
  }
}

/**
 * Domain contract for photo understanding. No Anthropic/Claude-specific
 * detail (model name, token limits, tool-use mechanics) belongs here —
 * `ClaudeVisionProvider` implements this.
 */
export interface VisionProvider {
  analyzeImage(input: VisionAnalysisInput): Promise<ImageAnalysis>;
}
