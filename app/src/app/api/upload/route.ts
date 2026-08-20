import { saveImageToProject, validateUploadedImageMimeType, UnsupportedImageError } from "@/lib/media/image-store";
import { ProjectStore } from "@/lib/storage/project-store";
import { PROJECTS_DATA_ROOT, UPLOADS_ROOT } from "@/lib/config/paths";
import type { ImportedListing } from "@/lib/listing/types";

const projectStore = new ProjectStore(PROJECTS_DATA_ROOT);

function optionalString(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalNumber(value: FormDataEntryValue | null): number | undefined {
  const str = optionalString(value);
  if (str === undefined) return undefined;
  const num = Number(str);
  return Number.isFinite(num) ? num : undefined;
}

/**
 * Fallback import path (Technical Plan Phase-1 instruction: first-class
 * feature, not an afterthought). Accepts manually uploaded photos plus
 * optional user-entered facts — never inferred, only what the user typed.
 *
 * An optional `projectId` field appends the uploaded photos to that
 * existing project instead of creating a new one — for adding more photos
 * (e.g. more exterior angles found after the first upload) without losing
 * the storyboard work already done on the first batch. Because the photo
 * set changed, any existing `imageAnalyses`/`storyboard`/`reel` are cleared
 * — they were built from the old photo set and would silently omit the
 * newly added photos otherwise; the client re-runs Analyze/Storyboard.
 */
export async function POST(request: Request): Promise<Response> {
  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return Response.json({ error: "INVALID_REQUEST", message: "Expected multipart form data." }, { status: 400 });
  }

  const files = formData.getAll("photos").filter((entry): entry is File => entry instanceof File);
  if (files.length === 0) {
    return Response.json(
      { error: "NO_PHOTOS", message: "Upload at least one property photo." },
      { status: 400 }
    );
  }

  const existingProjectId = optionalString(formData.get("projectId"));
  const existingProject = existingProjectId ? await projectStore.get(existingProjectId) : null;
  if (existingProjectId && !existingProject) {
    return Response.json({ error: "PROJECT_NOT_FOUND", message: "No such project." }, { status: 404 });
  }

  const project =
    existingProject ??
    (await projectStore.create("manual_upload", {
      sourceUrl: "manual-upload",
      platform: "manual",
      address: optionalString(formData.get("address")),
      price: optionalString(formData.get("price")),
      bedrooms: optionalNumber(formData.get("bedrooms")),
      bathrooms: optionalNumber(formData.get("bathrooms")),
      propertyType: optionalString(formData.get("propertyType")),
      description: optionalString(formData.get("description")),
      imageUrls: [],
    }));

  const savedImageUrls: string[] = [];
  const rejected: string[] = [];

  for (const file of files) {
    try {
      validateUploadedImageMimeType(file.type);
      const buffer = Buffer.from(await file.arrayBuffer());
      const saved = await saveImageToProject(buffer, file.type, project.id, UPLOADS_ROOT);
      savedImageUrls.push(saved.relativePath);
    } catch (error) {
      const message = error instanceof UnsupportedImageError ? error.message : "Failed to process image.";
      rejected.push(`${file.name}: ${message}`);
    }
  }

  if (savedImageUrls.length === 0) {
    return Response.json(
      { error: "NO_VALID_PHOTOS", message: "None of the uploaded files were usable images.", rejected },
      { status: 400 }
    );
  }

  const finalListing = {
    ...project.listing,
    imageUrls: [...project.listing.imageUrls, ...savedImageUrls],
  };

  if (existingProject) {
    await projectStore.save({
      ...project,
      listing: finalListing,
      imageAnalyses: undefined,
      storyboard: undefined,
      reel: undefined,
    });
  } else {
    await projectStore.save({ ...project, listing: finalListing });
  }

  return Response.json({ projectId: project.id, listing: finalListing, rejected }, { status: 200 });
}
