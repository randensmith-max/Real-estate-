import { z } from "zod";
import { BrandProfileStore } from "@/lib/brand/brand-profile-store";
import { BRAND_DATA_ROOT, UPLOADS_ROOT, BRAND_LOGO_PROJECT_ID } from "@/lib/config/paths";
import { saveImageToProject, validateUploadedImageMimeType, UnsupportedImageError } from "@/lib/media/image-store";

const store = new BrandProfileStore(BRAND_DATA_ROOT);

export async function GET(): Promise<Response> {
  const profile = await store.get();
  return Response.json({ profile }, { status: 200 });
}

const BrandProfileSchema = z.object({
  companyName: z.string().optional(),
  logoPath: z.string().optional(),
  agentName: z.string().optional(),
  phone: z.string().optional(),
  website: z.string().optional(),
  primaryColor: z.string().optional(),
  secondaryColor: z.string().optional(),
  cta: z.string().optional(),
});

/** Accepts either JSON (text fields only) or multipart (text fields + an optional `logo` file). */
export async function PUT(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";

  let fields: Record<string, string> = {};
  let logoFile: File | null = null;

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    for (const [key, value] of formData.entries()) {
      if (key === "logo" && value instanceof File) logoFile = value;
      else if (typeof value === "string" && value.trim()) fields[key] = value.trim();
    }
  } else {
    const body: unknown = await request.json().catch(() => null);
    if (body && typeof body === "object") fields = body as Record<string, string>;
  }

  const parsed = BrandProfileSchema.safeParse(fields);
  if (!parsed.success) {
    return Response.json({ error: "INVALID_BRAND_PROFILE", message: "Brand profile payload failed validation." }, { status: 400 });
  }

  const profile = { ...parsed.data };

  if (logoFile && logoFile.size > 0) {
    try {
      validateUploadedImageMimeType(logoFile.type);
      const buffer = Buffer.from(await logoFile.arrayBuffer());
      const saved = await saveImageToProject(buffer, logoFile.type, BRAND_LOGO_PROJECT_ID, UPLOADS_ROOT);
      profile.logoPath = saved.relativePath;
    } catch (error) {
      const message = error instanceof UnsupportedImageError ? error.message : "Failed to process logo image.";
      return Response.json({ error: "INVALID_LOGO", message }, { status: 400 });
    }
  } else {
    const existing = await store.get();
    profile.logoPath = existing.logoPath;
  }

  const saved = await store.save(profile);
  return Response.json({ profile: saved }, { status: 200 });
}
