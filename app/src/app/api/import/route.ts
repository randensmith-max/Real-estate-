import { z } from "zod";
import { detectProvider } from "@/lib/listing/registry";
import { ListingImportUnavailableError } from "@/lib/listing/types";
import { fetchRemoteImage, saveImageToProject, UnsupportedImageError } from "@/lib/media/image-store";
import { UnsafeImageUrlError } from "@/lib/media/ssrf";
import { ProjectStore } from "@/lib/storage/project-store";
import { PROJECTS_DATA_ROOT, UPLOADS_ROOT } from "@/lib/config/paths";

const RequestSchema = z.object({ url: z.string().min(1) });

const projectStore = new ProjectStore(PROJECTS_DATA_ROOT);

export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "INVALID_REQUEST", message: "A listing URL is required." },
      { status: 400 }
    );
  }

  const { url } = parsed.data;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return Response.json({ error: "INVALID_URL", message: "That is not a valid URL." }, { status: 400 });
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return Response.json({ error: "INVALID_URL", message: "Only http(s) URLs are supported." }, { status: 400 });
  }

  const provider = detectProvider(url);
  if (!provider) {
    return Response.json(
      { error: "UNSUPPORTED_PLATFORM", message: "Unsupported listing platform.", fallbackAvailable: true },
      { status: 422 }
    );
  }

  try {
    const listing = await provider.importListing(url);

    // Reserve the project record first so downloaded images have a stable directory to land in.
    const project = await projectStore.create("url_import", { ...listing, imageUrls: [] });

    const savedImageUrls: string[] = [];
    for (const imageUrl of listing.imageUrls) {
      try {
        const { buffer, contentType } = await fetchRemoteImage(imageUrl);
        const saved = await saveImageToProject(buffer, contentType, project.id, UPLOADS_ROOT);
        savedImageUrls.push(saved.relativePath);
      } catch (imageError) {
        // One bad image must not fail the whole import — degrade gracefully.
        console.warn(`Skipping image ${imageUrl}:`, (imageError as Error).message);
      }
    }

    const finalListing = { ...listing, imageUrls: savedImageUrls };
    await projectStore.save({ ...project, listing: finalListing });

    return Response.json({ projectId: project.id, listing: finalListing }, { status: 200 });
  } catch (error) {
    if (error instanceof ListingImportUnavailableError) {
      return Response.json(
        { error: error.level, platform: error.platform, message: error.reason, fallbackAvailable: true },
        { status: 422 }
      );
    }
    if (error instanceof UnsupportedImageError || error instanceof UnsafeImageUrlError) {
      return Response.json({ error: "MEDIA_ERROR", message: error.message }, { status: 502 });
    }
    console.error("Unexpected import error:", error);
    return Response.json(
      { error: "INTERNAL_ERROR", message: "Import failed unexpectedly." },
      { status: 500 }
    );
  }
}
