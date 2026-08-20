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
};
