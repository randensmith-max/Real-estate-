import { z } from "zod";
import { ProjectStore } from "@/lib/storage/project-store";
import { PROJECTS_DATA_ROOT } from "@/lib/config/paths";
import { buildStoryboard } from "@/lib/storyboard/storyboard-builder";
import { CAMERA_MOTIONS } from "@/lib/vision/schema";

const projectStore = new ProjectStore(PROJECTS_DATA_ROOT);

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
): Promise<Response> {
  const { projectId } = await params;
  const project = await projectStore.get(projectId);
  if (!project) {
    return Response.json({ error: "PROJECT_NOT_FOUND", message: "No such project." }, { status: 404 });
  }
  if (!project.imageAnalyses || project.imageAnalyses.length === 0) {
    return Response.json(
      { error: "NOT_ANALYZED", message: "Run photo analysis before generating a storyboard." },
      { status: 400 }
    );
  }

  const storyboard = buildStoryboard(project.imageAnalyses);
  await projectStore.save({ ...project, storyboard });

  return Response.json({ projectId, storyboard }, { status: 200 });
}

const StoryboardSceneSchema = z.object({
  id: z.string(),
  order: z.number().int().nonnegative(),
  imageId: z.string(),
  roomType: z.string(),
  cameraMotion: z.enum(CAMERA_MOTIONS),
  durationSeconds: z.number().min(1).max(10),
  higgsfieldPrompt: z.string().min(1),
  status: z.enum(["planned", "generating", "generated", "approved", "rejected"]),
});

const PatchSchema = z.object({ storyboard: z.array(StoryboardSceneSchema) });

/**
 * Full-array replace: the client sends back the edited storyboard (after
 * reordering / removing / replacing image / changing camera motion / editing
 * prompt / changing duration / approving) and it is validated + persisted.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
): Promise<Response> {
  const { projectId } = await params;
  const project = await projectStore.get(projectId);
  if (!project) {
    return Response.json({ error: "PROJECT_NOT_FOUND", message: "No such project." }, { status: 404 });
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "INVALID_STORYBOARD", message: "Storyboard payload failed validation.", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  await projectStore.save({ ...project, storyboard: parsed.data.storyboard });
  return Response.json({ projectId, storyboard: parsed.data.storyboard }, { status: 200 });
}
