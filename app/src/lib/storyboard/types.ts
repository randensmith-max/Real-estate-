export type StoryboardSceneStatus = "planned" | "generating" | "generated" | "approved" | "rejected";

export type StoryboardScene = {
  id: string;
  order: number;
  imageId: string;
  roomType: string;
  cameraMotion: string;
  durationSeconds: number;
  higgsfieldPrompt: string;
  status: StoryboardSceneStatus;
  /** Phase 3 addition (optional — Phase 2 storyboards omit these): set once generation has been attempted. */
  providerJobId?: string;
  /** Phase 3 addition: local servable path to the downloaded clip, once status is "generated"/"approved". */
  generatedVideoUrl?: string;
  /** Phase 3 addition: set when status is "rejected" due to a generation failure (vs. a manual reject). */
  generationError?: string;
};
