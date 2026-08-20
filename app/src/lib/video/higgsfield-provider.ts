import { HiggsfieldClient as HiggsfieldV1Client } from "@higgsfield/client";
import { createHiggsfieldClient } from "@higgsfield/client/v2";
import type { V2Response } from "@higgsfield/client/v2";
import {
  AuthenticationError,
  NotEnoughCreditsError,
  APIError as HiggsfieldAPIError,
} from "@higgsfield/client";
import {
  VideoGenerationError,
  type VideoGenerationProvider,
  type GenerateSceneInput,
  type ProviderJob,
  type ProviderJobStatus,
  type GeneratedVideo,
} from "./provider";

/**
 * Official Higgsfield SDK implementation of `VideoGenerationProvider`.
 *
 * Architectural note (see docs/adr/0003-higgsfield-polling-model.md): the
 * v2 client's public interface (`@higgsfield/client/v2`) exposes only
 * `subscribe()`, which — per its own `withPolling` option — handles
 * submit-and-poll-until-terminal as a single call; there is no separately
 * exposed "check status of an existing request" method on the public v2
 * client. So `generateScene` here calls `subscribe(..., { withPolling:
 * true })` (the SDK's own recommended/default mode) and caches the
 * resolved result; `getJobStatus`/`downloadResult` read from that cache
 * rather than performing an independent live poll. This is not a
 * simplification of the officially documented API — it is what the
 * officially documented API's public TypeScript surface actually supports.
 *
 * Image upload uses the (README-labelled "deprecated but still supported")
 * v1 client's `uploadImage()`, since the v2 client has no upload method of
 * its own and `/v1/image2video/dop` requires an `image_url`, not raw bytes.
 */
export class HiggsfieldProvider implements VideoGenerationProvider {
  private readonly v1Client: HiggsfieldV1Client;
  private readonly v2Client: ReturnType<typeof createHiggsfieldClient>;
  private readonly resultCache = new Map<string, V2Response>();

  constructor(
    credentials: string,
    private readonly model: "dop-lite" | "dop-turbo" | "dop-standard" = "dop-turbo"
  ) {
    if (!credentials) {
      throw new VideoGenerationError("HF_CREDENTIALS is required to use HiggsfieldProvider.", false);
    }
    const [apiKey, apiSecret] = credentials.split(":");
    if (!apiKey || !apiSecret) {
      throw new VideoGenerationError(
        'HF_CREDENTIALS must be in "KEY_ID:KEY_SECRET" format.',
        false
      );
    }
    this.v1Client = new HiggsfieldV1Client({ apiKey, apiSecret });
    this.v2Client = createHiggsfieldClient({ credentials });
  }

  async generateScene(input: GenerateSceneInput): Promise<ProviderJob> {
    let imageUrl: string;
    try {
      imageUrl = await this.v1Client.uploadImage(input.sourceImageBuffer, input.sourceImageFormat);
    } catch (error) {
      throw wrapHiggsfieldError(error, "uploading source image");
    }

    let response: V2Response;
    try {
      response = await this.v2Client.subscribe("/v1/image2video/dop", {
        input: {
          model: this.model,
          prompt: input.prompt,
          input_images: [{ type: "image_url", image_url: imageUrl }],
        },
        withPolling: true,
      });
    } catch (error) {
      throw wrapHiggsfieldError(error, "generating video");
    }

    this.resultCache.set(response.request_id, response);
    return { providerJobId: response.request_id };
  }

  async getJobStatus(jobId: string): Promise<ProviderJobStatus> {
    const cached = this.resultCache.get(jobId);
    if (!cached) {
      throw new VideoGenerationError(`Unknown Higgsfield job id: ${jobId}`, false);
    }

    switch (cached.status) {
      case "queued":
      case "in_progress":
        return { status: cached.status };
      case "completed":
        return { status: "completed" };
      case "failed":
        return { status: "failed", reason: "Generation failed on the provider side." };
      case "nsfw":
        return { status: "nsfw", reason: "Content was rejected by moderation; credits were refunded." };
    }
  }

  async downloadResult(jobId: string): Promise<GeneratedVideo> {
    const cached = this.resultCache.get(jobId);
    if (!cached) {
      throw new VideoGenerationError(`Unknown Higgsfield job id: ${jobId}`, false);
    }
    if (cached.status !== "completed" || !cached.video?.url) {
      throw new VideoGenerationError(
        `Cannot download job ${jobId}: status is "${cached.status}", not "completed".`,
        false
      );
    }

    const response = await fetch(cached.video.url);
    if (!response.ok) {
      throw new VideoGenerationError(
        `Failed to download generated video (HTTP ${response.status}).`,
        true
      );
    }
    const contentType = response.headers.get("content-type") ?? "video/mp4";
    const buffer = Buffer.from(await response.arrayBuffer());
    return { buffer, contentType };
  }
}

function wrapHiggsfieldError(error: unknown, action: string): VideoGenerationError {
  if (error instanceof AuthenticationError) {
    return new VideoGenerationError(`Higgsfield authentication failed while ${action}.`, false, error);
  }
  if (error instanceof NotEnoughCreditsError) {
    return new VideoGenerationError(`Higgsfield account has insufficient credits.`, false, error);
  }
  if (error instanceof HiggsfieldAPIError) {
    const status = error.statusCode;
    const retryable = status === 429 || status === 502 || status === 503 || status === 504;
    return new VideoGenerationError(
      `Higgsfield API error while ${action}: ${error.message}`,
      retryable,
      error
    );
  }
  return new VideoGenerationError(
    `Unexpected error while ${action}: ${(error as Error).message}`,
    false,
    error
  );
}
