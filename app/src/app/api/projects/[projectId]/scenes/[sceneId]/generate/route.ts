import path from "node:path";
import { readFile } from "node:fs/promises";
import { ProjectStore } from "@/lib/storage/project-store";
import { PROJECTS_DATA_ROOT, UPLOADS_ROOT, VIDEOS_ROOT } from "@/lib/config/paths";
import { HiggsfieldProvider } from "@/lib/video/higgsfield-provider";
import { VideoGenerationError } from "@/lib/video/provider";
import { saveVideoToProject } from "@/lib/media/video-store";
import type { StoryboardScene } from "@/lib/storyboard/types";

const projectStore = new ProjectStore(PROJECTS_DATA_ROOT);

function formatFromExtension(ext: string): "jpeg" | "png" | "webp" {
  if (ext === ".jpg" || ext === ".jpeg") return "jpeg";
  if (ext === ".png") return "png";
  return "webp";
}

/**
 * Generates (or regenerates — calling this again on the same scene is the
 * spec's "regenerate" action) exactly one storyboard scene. The client
 * calls this once per approved scene, sequentially, to implement the
 * "Generating scene 1 of 8" progress UI and the "conservative concurrency
 * — don't fire every scene simultaneously" requirement (see ADR 0003).
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; sceneId: string }> }
): Promise<Response> {
  const { projectId, sceneId } = await params;
  const project = await projectStore.get(projectId);
  if (!project) {
    return Response.json({ error: "PROJECT_NOT_FOUND", message: "No such project." }, { status: 404 });
  }

  const storyboard = project.storyboard ?? [];
  const sceneIndex = storyboard.findIndex((s) => s.id === sceneId);
  if (sceneIndex === -1) {
    return Response.json({ error: "SCENE_NOT_FOUND", message: "No such scene." }, { status: 404 });
  }
  const scene = storyboard[sceneIndex]!;

  const credentials = process.env.HF_CREDENTIALS;
  if (!credentials) {
    return Response.json(
      {
        error: "VIDEO_PROVIDER_UNCONFIGURED",
        message: "HF_CREDENTIALS is not set. Higgsfield generation requires this environment variable — see .env.example.",
      },
      { status: 503 }
    );
  }

  await setSceneStatus(project.id, storyboard, sceneIndex, { status: "generating" });

  try {
    const filename = path.basename(scene.imageId);
    const imagePath = path.join(UPLOADS_ROOT, projectId, filename);
    const sourceImageBuffer = await readFile(imagePath);
    const sourceImageFormat = formatFromExtension(path.extname(filename));

    const provider = new HiggsfieldProvider(credentials);
    const job = await provider.generateScene({
      sourceImageBuffer,
      sourceImageFormat,
      prompt: scene.higgsfieldPrompt,
    });

    const status = await provider.getJobStatus(job.providerJobId);

    if (status.status === "completed") {
      const video = await provider.downloadResult(job.providerJobId);
      const saved = await saveVideoToProject(video.buffer, projectId, VIDEOS_ROOT);
      const updated = await setSceneStatus(project.id, storyboard, sceneIndex, {
        status: "generated",
        providerJobId: job.providerJobId,
        generatedVideoUrl: saved.relativePath,
        generationError: undefined,
      });
      return Response.json({ projectId, scene: updated }, { status: 200 });
    }

    const reason = status.status === "failed" || status.status === "nsfw" ? status.reason : "Generation did not complete.";
    const updated = await setSceneStatus(project.id, storyboard, sceneIndex, {
      status: "rejected",
      providerJobId: job.providerJobId,
      generationError: reason,
    });
    return Response.json({ projectId, scene: updated, message: reason }, { status: 200 });
  } catch (error) {
    const message = error instanceof VideoGenerationError ? error.message : "Generation failed unexpectedly.";
    const updated = await setSceneStatus(project.id, storyboard, sceneIndex, {
      status: "rejected",
      generationError: message,
    });
    return Response.json({ projectId, scene: updated, error: "GENERATION_FAILED", message }, { status: 502 });
  }
}

async function setSceneStatus(
  projectId: string,
  storyboard: StoryboardScene[],
  sceneIndex: number,
  patch: Partial<StoryboardScene>
): Promise<StoryboardScene> {
  const project = await projectStore.get(projectId);
  if (!project) throw new Error("Project disappeared during generation.");

  const currentStoryboard = project.storyboard ?? storyboard;
  const updatedScene = { ...currentStoryboard[sceneIndex]!, ...patch };
  const updatedStoryboard = currentStoryboard.map((s, i) => (i === sceneIndex ? updatedScene : s));

  await projectStore.save({ ...project, storyboard: updatedStoryboard });
  return updatedScene;
}
