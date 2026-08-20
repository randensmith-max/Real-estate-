import path from "node:path";
import { copyFile, rm, mkdir } from "node:fs/promises";
import { ProjectStore } from "@/lib/storage/project-store";
import { PROJECTS_DATA_ROOT, RENDERS_ROOT, RENDER_WORK_ROOT } from "@/lib/config/paths";
import { BrandProfileStore } from "@/lib/brand/brand-profile-store";
import { BRAND_DATA_ROOT } from "@/lib/config/paths";
import { renderBrandedReel, HyperFramesRenderError } from "@/lib/media/hyperframes-renderer";
import type { ReelBrandingData } from "@/lib/media/hyperframes-composition";

const projectStore = new ProjectStore(PROJECTS_DATA_ROOT);
const brandStore = new BrandProfileStore(BRAND_DATA_ROOT);

/**
 * Overlays branding (Phase 5) on the already-assembled plain reel
 * (Phase 4). Requires `POST /api/projects/[id]/reel` to have run first.
 * `data` in the request body supplies the property facts to display
 * (address/cityState/price/bedrooms/bathrooms/featureCallout) — never
 * inferred, only what the caller supplies (mirrors the "never invent
 * facts" principle from listing import).
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
  if (!project.reel) {
    return Response.json(
      { error: "NO_REEL", message: "Build the plain reel first (POST /api/projects/[id]/reel)." },
      { status: 400 }
    );
  }

  const body: unknown = await request.json().catch(() => ({}));
  const data = (body ?? {}) as ReelBrandingData;

  const brand = await brandStore.get();
  const reelPath = path.join(RENDERS_ROOT, projectId, "final-reel.mp4");
  const workDir = path.join(RENDER_WORK_ROOT, `${projectId}-branding`);

  try {
    const result = await renderBrandedReel({ reelVideoPath: reelPath, brand, data }, workDir);

    const outputDir = path.join(RENDERS_ROOT, projectId);
    await mkdir(outputDir, { recursive: true });
    const finalPath = path.join(outputDir, "final-reel-branded.mp4");
    await copyFile(result.outputPath, finalPath);

    const brandedVideoUrl = `/api/renders/${projectId}/final-reel-branded.mp4`;
    await projectStore.save({ ...project, reel: { ...project.reel, brandedVideoUrl } });

    await rm(workDir, { recursive: true, force: true });

    return Response.json({ projectId, brandedVideoUrl }, { status: 200 });
  } catch (error) {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    const message = error instanceof HyperFramesRenderError ? error.message : "Branding render failed unexpectedly.";
    return Response.json({ error: "BRANDING_FAILED", message }, { status: 502 });
  }
}
