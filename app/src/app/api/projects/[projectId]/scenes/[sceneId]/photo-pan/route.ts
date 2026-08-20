import path from "node:path";
import { readFile, rm, mkdir } from "node:fs/promises";
import { ProjectStore } from "@/lib/storage/project-store";
import { PROJECTS_DATA_ROOT, UPLOADS_ROOT, VIDEOS_ROOT, RENDER_WORK_ROOT } from "@/lib/config/paths";
import { renderKenBurnsClip } from "@/lib/media/ken-burns";
import { FFmpegError } from "@/lib/media/ffmpeg-runner";
import { saveVideoToProject } from "@/lib/media/video-store";
import type { StoryboardScene } from "@/lib/storyboard/types";

const projectStore = new ProjectStore(PROJECTS_DATA_ROOT);

/**
 * Fallback scene source that needs no external video-generation provider:
 * renders a pan/zoom ("Ken Burns") clip directly from the scene's source
 * photo. Exists so a Higgsfield outage (or an account not yet approved for
 * generation) doesn't fully block producing a reel — the resulting scene
 * is indistinguishable, to the rest of the pipeline, from a downloaded
 * Higgsfield clip: same status field, same `generatedVideoUrl`, same
 * eligibility for reel assembly.
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

  await setSceneStatus(project.id, storyboard, sceneIndex, { status: "generating" });

  const workDir = path.join(RENDER_WORK_ROOT, projectId);
  const tempClipPath = path.join(workDir, `photo-pan-${sceneId}.mp4`);

  try {
    const filename = path.basename(scene.imageId);
    const imagePath = path.join(UPLOADS_ROOT, projectId, filename);

    await mkdir(workDir, { recursive: true });
    await renderKenBurnsClip(imagePath, tempClipPath, {
      cameraMotion: scene.cameraMotion,
      durationSeconds: scene.durationSeconds,
    });

    const clipBuffer = await readFile(tempClipPath);
    const saved = await saveVideoToProject(clipBuffer, projectId, VIDEOS_ROOT);

    const updated = await setSceneStatus(project.id, storyboard, sceneIndex, {
      status: "generated",
      generatedVideoUrl: saved.relativePath,
      generationError: undefined,
    });
    return Response.json({ projectId, scene: updated }, { status: 200 });
  } catch (error) {
    const message =
      error instanceof FFmpegError ? error.message : "Photo-pan rendering failed unexpectedly.";
    const updated = await setSceneStatus(project.id, storyboard, sceneIndex, {
      status: "rejected",
      generationError: message,
    });
    return Response.json({ projectId, scene: updated, error: "PHOTO_PAN_FAILED", message }, { status: 502 });
  } finally {
    await rm(tempClipPath, { force: true }).catch(() => undefined);
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
