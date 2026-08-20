import Anthropic from "@anthropic-ai/sdk";
import { ImageAnalysisSchema, ROOM_TYPES, CAMERA_MOTIONS, type ImageAnalysis } from "./schema";
import { VisionAnalysisError, type VisionProvider, type VisionAnalysisInput } from "./provider";

const TOOL_NAME = "record_image_analysis";

const ANALYSIS_TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description:
    "Record structured analysis of one real-estate listing photograph for cinematic reel planning.",
  input_schema: {
    type: "object",
    properties: {
      roomType: { type: "string", enum: [...ROOM_TYPES] },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      visualQualityScore: { type: "number", minimum: 0, maximum: 10 },
      marketingValueScore: { type: "number", minimum: 0, maximum: 10 },
      cinematicPotentialScore: { type: "number", minimum: 0, maximum: 10 },
      observedFeatures: { type: "array", items: { type: "string" } },
      recommendedCameraMotion: { type: "string", enum: [...CAMERA_MOTIONS] },
      recommendedDurationSeconds: { type: "number", minimum: 1, maximum: 10 },
      useInReel: { type: "boolean" },
      reason: { type: "string" },
    },
    required: [
      "roomType",
      "confidence",
      "visualQualityScore",
      "marketingValueScore",
      "cinematicPotentialScore",
      "observedFeatures",
      "recommendedCameraMotion",
      "recommendedDurationSeconds",
      "useInReel",
      "reason",
    ],
  },
};

const SYSTEM_PROMPT = `You analyze real-estate listing photographs for a cinematic reel generator.

Distinguish clearly between what you can directly OBSERVE in the image and anything else.
Never invent or assume: room dimensions, renovations, materials, appliance/fixture brands,
views outside windows, neighborhood characteristics, school quality, or structural features
that are not visible in the photograph. If the listing description or key features mention
something, you may reference it only if it is explicitly given to you as verified listing
context — never infer it from the photo alone.

"observedFeatures" must only list things visibly present in the image.
"reason" should briefly explain your scoring/recommendation grounded in what is visible.
Call the record_image_analysis tool exactly once with your structured analysis.`;

function buildUserContent(input: VisionAnalysisInput): Anthropic.MessageParam["content"] {
  const contextLines: string[] = [];
  if (input.listingContext.propertyType) {
    contextLines.push(`Property type (from listing): ${input.listingContext.propertyType}`);
  }
  if (input.listingContext.keyFeatures?.length) {
    contextLines.push(`Listed key features: ${input.listingContext.keyFeatures.join(", ")}`);
  }
  if (input.listingContext.description) {
    contextLines.push(`Listing description: ${input.listingContext.description}`);
  }

  return [
    {
      type: "image",
      source: {
        type: "base64",
        media_type: input.mimeType,
        data: input.imageBuffer.toString("base64"),
      },
    },
    {
      type: "text",
      text:
        `Analyze this listing photograph (imageId: ${input.imageId}).\n\n` +
        (contextLines.length
          ? `Verified listing context (use only as corroborating context, not as image content):\n${contextLines.join("\n")}\n\n`
          : "No additional verified listing context was provided.\n\n") +
        "Call record_image_analysis now.",
    },
  ];
}

function extractToolInput(message: Anthropic.Message): unknown {
  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === TOOL_NAME
  );
  return toolUse?.input;
}

/**
 * Official Anthropic API implementation of `VisionProvider`. Forces
 * structured output via tool-use (the tool's `input_schema` mirrors
 * `ImageAnalysisSchema`) rather than parsing free-form text, then validates
 * the result with zod — Claude's raw response is never trusted directly.
 * One repair attempt is made on validation failure before giving up.
 */
export class ClaudeVisionProvider implements VisionProvider {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    // Sonnet 5, not Opus: this call runs once per photo and a listing can have
    // dozens — structured room/quality classification doesn't need Opus-level
    // reasoning, and the cost difference compounds fast across a whole listing.
    // Override via the constructor if a specific deployment wants otherwise.
    private readonly model: string = "claude-sonnet-5"
  ) {
    if (!apiKey) {
      throw new VisionAnalysisError(
        "ANTHROPIC_API_KEY is required to use ClaudeVisionProvider.",
        false
      );
    }
    this.client = new Anthropic({ apiKey });
  }

  async analyzeImage(input: VisionAnalysisInput): Promise<ImageAnalysis> {
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: buildUserContent(input) }];

    let lastValidationError: string | null = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      if (lastValidationError) {
        messages.push({
          role: "user",
          content:
            `Your previous record_image_analysis call did not match the required schema: ` +
            `${lastValidationError}. Call record_image_analysis again with a corrected input.`,
        });
      }

      let response: Anthropic.Message;
      try {
        response = await this.client.messages.create({
          model: this.model,
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          tools: [ANALYSIS_TOOL],
          tool_choice: { type: "tool", name: TOOL_NAME },
          messages,
        });
      } catch (error) {
        const retryable = isRetryableAnthropicError(error);
        throw new VisionAnalysisError(
          `Claude Vision request failed: ${(error as Error).message}`,
          retryable,
          error
        );
      }

      const rawInput = extractToolInput(response);
      const withImageId = { ...(rawInput as object), imageId: input.imageId };
      const parsed = ImageAnalysisSchema.safeParse(withImageId);

      if (parsed.success) {
        return parsed.data;
      }

      lastValidationError = parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
    }

    throw new VisionAnalysisError(
      `Claude Vision response failed schema validation after repair attempt: ${lastValidationError}`,
      false
    );
  }
}

function isRetryableAnthropicError(error: unknown): boolean {
  if (error instanceof Anthropic.APIError) {
    const status = error.status;
    return status === 429 || status === 502 || status === 503 || status === 504;
  }
  return false;
}
