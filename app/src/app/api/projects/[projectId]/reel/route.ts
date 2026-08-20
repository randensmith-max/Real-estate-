import path from "node:path";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { ProjectStore } from "@/lib/storage/project-store";
import { PROJECTS_DATA_ROOT, VIDEOS_ROOT, RENDERS_ROOT, RENDER_WORK_ROOT } from "@/lib/config/paths";
import { assembleReel, type ReelScene } from "@/lib/media/reel-assembler";
import { FFmpegError } from "@/lib/media/ffmpeg-runner";

const projectStore = new ProjectStore(PROJECTS_DATA_ROOT);
const ALLOWED_MUSIC_TYPES = new Set(["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/aac"]);

/**
 * Assembles the final reel from every storyboard scene with a generated
 * clip, in storyboard order (spec: "Use storyboard order"). Optional
 * multipart "music" field supplies user-uploaded background music (spec:
 * never auto-ship copyrighted commercial tracks as a default) — omit it
 * for a silent reel.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
): Promise<Response> {
  const { projectId } = await params;
  const project = await projectStore.get(projectId);
  if (!project) {
    return Response.json({ error: "PROJECT_NOT_FOUND", message: "No such project." }, { status: 404 });
  }

  const storyboard = project.storyboard ?? [];
  const readyScenes = storyboard
    .filter((s) => s.generatedVideoUrl && (s.status === "generated" || s.status === "approved"))
    .sort((a, b) => a.order - b.order);

  if (readyScenes.length === 0) {
    return Response.json(
      { error: "NO_GENERATED_SCENES", message: "No generated clips are available to assemble into a reel yet." },
      { status: 400 }
    );
  }

  const workDir = path.join(RENDER_WORK_ROOT, projectId);
  const outputDir = path.join(RENDERS_ROOT, projectId);

  let musicPath: string | null = null;
  try {
    const formData = await request.formData().catch(() => null);
    const musicFile = formData?.get("music");
    if (musicFile instanceof File && musicFile.size > 0) {
      if (!ALLOWED_MUSIC_TYPES.has(musicFile.type)) {
        return Response.json(
          { error: "UNSUPPORTED_MUSIC_TYPE", message: `Unsupported audio type: ${musicFile.type}` },
          { status: 400 }
        );
      }
      await mkdir(workDir, { recursive: true });
      musicPath = path.join(workDir, `music${path.extname(musicFile.name) || ".mp3"}`);
      await writeFile(musicPath, Buffer.from(await musicFile.arrayBuffer()));
    }

    const scenes: ReelScene[] = readyScenes.map((s) => ({
      videoPath: path.join(VIDEOS_ROOT, projectId, path.basename(s.generatedVideoUrl!)),
      durationSeconds: s.durationSeconds,
    }));

    const result = await assembleReel(scenes, workDir, outputDir, musicPath);

    const reel = {
      videoUrl: `/api/renders/${projectId}/final-reel.mp4`,
      thumbnailUrl: `/api/renders/${projectId}/thumbnail.jpg`,
      durationSeconds: result.durationSeconds,
    };
    await projectStore.save({ ...project, reel });

    await rm(workDir, { recursive: true, force: true });

    return Response.json(
      { projectId, reel, withinTargetDuration: result.withinTargetDuration, sceneCount: scenes.length },
      { status: 200 }
    );
  } catch (error) {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    const message = error instanceof FFmpegError ? error.message : "Reel assembly failed unexpectedly.";
    return Response.json({ error: "REEL_ASSEMBLY_FAILED", message }, { status: 502 });
  }
}
