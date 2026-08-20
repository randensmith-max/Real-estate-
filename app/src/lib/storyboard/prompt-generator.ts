import type { ImageAnalysis } from "../vision/schema";

/**
 * Preservation instruction used as the foundation of every Higgsfield
 * prompt — property-preservation is the single highest-priority concern
 * for generated video (hallucinated architecture/furniture is the main
 * failure mode of image-to-video models).
 */
export const PRESERVATION_INSTRUCTION =
  "Create subtle cinematic real-estate camera movement from this exact source image. " +
  "Preserve the exact architecture, walls, windows, doors, furniture, fixtures, materials, " +
  "lighting, landscaping, proportions, and room layout. Do not add, remove, redesign, " +
  "replace, or transform objects. Do not create new rooms or structural features. No " +
  "people. Keep the property visually faithful to the source photograph.";

const CAMERA_MOTION_PHRASES: Record<ImageAnalysis["recommendedCameraMotion"], string> = {
  push_in: "Slow cinematic push in toward the focal point of the room.",
  pull_back: "Slow cinematic pull back, revealing the full space.",
  pan_left: "Slow cinematic pan left across the room.",
  pan_right: "Slow cinematic pan right across the room.",
  dolly_forward: "Slow cinematic dolly forward with restrained natural parallax.",
  subtle_parallax: "Subtle parallax drift, camera nearly static.",
  gentle_orbit: "Gentle, restrained orbit around the central subject — small angle only.",
  static: "Locked-off static shot with only the faintest breathing motion.",
};

const AVOID_CLAUSE =
  " Stable luxury real-estate cinematography. Avoid large camera rotations, aggressive zoom, " +
  "surreal motion, object animation, or furniture movement.";

/**
 * Builds the exact per-scene Higgsfield prompt: the fixed preservation
 * instruction, plus the scene's specific camera movement, plus a closing
 * clause steering away from AI-looking artifacts.
 */
export function buildHiggsfieldPrompt(cameraMotion: ImageAnalysis["recommendedCameraMotion"]): string {
  return `${PRESERVATION_INSTRUCTION} ${CAMERA_MOTION_PHRASES[cameraMotion]}${AVOID_CLAUSE}`;
}
