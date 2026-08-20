import path from "node:path";
import { z } from "zod";
import { copyFile, rm, mkdir } from "node:fs/promises";
import { ProjectStore } from "@/lib/storage/project-store";
import { PROJECTS_DATA_ROOT, RENDERS_ROOT, RENDER_WORK_ROOT } from "@/lib/config/paths";
import { BrandProfileStore } from "@/lib/brand/brand-profile-store";
import { BRAND_DATA_ROOT } from "@/lib/config/paths";
import { renderBrandedReel, HyperFramesRenderError } from "@/lib/media/hyperframes-renderer";

const projectStore = new ProjectStore(PROJECTS_DATA_ROOT);
const brandStore = new BrandProfileStore(BRAND_DATA_ROOT);

// Runtime validation matters here beyond typechecking: these values are interpolated
// directly into generated HTML (hyperframes-composition.ts). A bare `as ReelBrandingData`
// cast on parsed JSON would let a caller send e.g. bedrooms as an unescaped HTML string.
const ReelBrandingDataSchema = z.object({
  address: z.string().max(200).optional(),
  cityState: z.string().max(200).optional(),
  price: z.string().max(100).optional(),
  bedrooms: z.number().int().nonnegative().max(100).optional(),
  bathrooms: z.number().nonnegative().max(100).optional(),
  featureCallout: z.string().max(120).optional(),
});

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
  const parsed = ReelBrandingDataSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json(
      { error: "INVALID_BRANDING_DATA", message: "Branding data payload failed validation.", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const data = parsed.data;

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
