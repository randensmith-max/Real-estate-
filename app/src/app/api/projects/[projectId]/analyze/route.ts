import path from "node:path";
import { readFile } from "node:fs/promises";
import { ProjectStore } from "@/lib/storage/project-store";
import { PROJECTS_DATA_ROOT, UPLOADS_ROOT } from "@/lib/config/paths";
import { ClaudeVisionProvider } from "@/lib/vision/claude-vision-provider";
import { VisionAnalysisError } from "@/lib/vision/provider";
import { mimeForExtension } from "@/lib/media/image-store";
import type { ImageAnalysis } from "@/lib/vision/schema";

const projectStore = new ProjectStore(PROJECTS_DATA_ROOT);

function absoluteImagePath(projectId: string, imageUrl: string): string {
  // imageUrl looks like "/api/images/{projectId}/{filename}" — the filename
  // is exactly what saveImageToProject wrote to disk under UPLOADS_ROOT.
  const filename = path.basename(imageUrl);
  return path.join(UPLOADS_ROOT, projectId, filename);
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
): Promise<Response> {
  const { projectId } = await params;
  const project = await projectStore.get(projectId);
  if (!project) {
    return Response.json({ error: "PROJECT_NOT_FOUND", message: "No such project." }, { status: 404 });
  }
  if (project.listing.imageUrls.length === 0) {
    return Response.json(
      { error: "NO_IMAGES", message: "This project has no images to analyze." },
      { status: 400 }
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      {
        error: "VISION_PROVIDER_UNCONFIGURED",
        message:
          "ANTHROPIC_API_KEY is not set. Claude Vision analysis requires this environment " +
          "variable — see .env.example.",
      },
      { status: 503 }
    );
  }

  const visionProvider = new ClaudeVisionProvider(apiKey);

  const analyses: ImageAnalysis[] = [];
  const failures: { imageId: string; message: string }[] = [];

  for (const imageUrl of project.listing.imageUrls) {
    try {
      const filePath = absoluteImagePath(projectId, imageUrl);
      const buffer = await readFile(filePath);
      const mimeType = mimeForExtension(path.extname(filePath));

      const analysis = await visionProvider.analyzeImage({
        imageId: imageUrl,
        imageBuffer: buffer,
        mimeType,
        listingContext: {
          description: project.listing.description,
          keyFeatures: project.listing.keyFeatures,
          propertyType: project.listing.propertyType,
        },
      });
      analyses.push(analysis);
    } catch (error) {
      const message = error instanceof VisionAnalysisError ? error.message : "Analysis failed unexpectedly.";
      // One bad image must not fail the whole batch — degrade gracefully, same principle as import.
      failures.push({ imageId: imageUrl, message });
    }
  }

  if (analyses.length === 0) {
    return Response.json(
      { error: "ANALYSIS_FAILED", message: "No images could be analyzed.", failures },
      { status: 502 }
    );
  }

  await projectStore.save({ ...project, imageAnalyses: analyses });

  return Response.json({ projectId, imageAnalyses: analyses, failures }, { status: 200 });
}
