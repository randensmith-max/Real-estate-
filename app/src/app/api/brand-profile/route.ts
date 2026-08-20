import { z } from "zod";
import { BrandProfileStore } from "@/lib/brand/brand-profile-store";
import { BRAND_DATA_ROOT, UPLOADS_ROOT, BRAND_LOGO_PROJECT_ID } from "@/lib/config/paths";
import { saveImageToProject, validateUploadedImageMimeType, UnsupportedImageError } from "@/lib/media/image-store";
import type { BrandProfile } from "@/lib/brand/types";

const store = new BrandProfileStore(BRAND_DATA_ROOT);

export async function GET(): Promise<Response> {
  const profile = await store.get();
  return Response.json({ profile }, { status: 200 });
}

// logoPath is intentionally NOT part of this schema — it is never accepted from the
// client, only ever set below from a real saved upload or the existing stored value.
// primaryColor/secondaryColor are interpolated directly into a <style> block in the
// generated HyperFrames composition (hyperframes-composition.ts) — a strict hex-color
// format here is what keeps that safe, not the escaping used for the text fields below.
const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const BrandProfileSchema = z.object({
  companyName: z.string().max(200).optional(),
  agentName: z.string().max(200).optional(),
  phone: z.string().max(50).optional(),
  website: z.string().max(200).optional(),
  primaryColor: z.string().regex(HEX_COLOR, "Must be a hex color like #112233").optional(),
  secondaryColor: z.string().regex(HEX_COLOR, "Must be a hex color like #112233").optional(),
  cta: z.string().max(60).optional(),
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

  const profile: BrandProfile = { ...parsed.data };

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
