import { randomUUID } from "node:crypto";
import type { ImageAnalysis } from "../vision/schema";
import type { StoryboardScene } from "./types";
import { selectShots } from "./shot-selector";
import { buildHiggsfieldPrompt } from "./prompt-generator";

/**
 * Turns ranked/analyzed images into an ordered, editable storyboard
 * (spec: "The storyboard must be editable before spending Higgsfield
 * credits"). Pure function — no side effects, no provider calls — so it's
 * fully unit-testable and safe to call repeatedly while the user edits.
 */
export function buildStoryboard(analyses: ImageAnalysis[]): StoryboardScene[] {
  const selected = selectShots(analyses);

  return selected.map((analysis, index) => ({
    id: randomUUID(),
    order: index,
    imageId: analysis.imageId,
    roomType: analysis.roomType,
    cameraMotion: analysis.recommendedCameraMotion,
    durationSeconds: analysis.recommendedDurationSeconds,
    higgsfieldPrompt: buildHiggsfieldPrompt(analysis.recommendedCameraMotion),
    status: "planned",
  }));
}
