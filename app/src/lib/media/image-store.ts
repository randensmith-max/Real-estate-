import { mkdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { assertSafeImageUrl } from "./ssrf";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15MB — generous for listing photos, guards against decompression-bomb-style abuse

export class UnsupportedImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedImageError";
  }
}

export function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function extensionForMime(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    default:
      throw new UnsupportedImageError(`Unsupported MIME type: ${mimeType}`);
  }
}

/** Inverse of `extensionForMime` — used when reading a stored file back off disk. */
export function mimeForExtension(extension: string): "image/jpeg" | "image/png" | "image/webp" {
  switch (extension) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    default:
      throw new UnsupportedImageError(`Unsupported file extension: ${extension}`);
  }
}

/**
 * Downloads a single remote image (Technical Plan §14-§15): validates the
 * URL is not an SSRF vector, caps response size, and validates the actual
 * declared content type before returning bytes for storage.
 */
export async function fetchRemoteImage(
  rawUrl: string
): Promise<{ buffer: Buffer; contentType: string }> {
  const url = await assertSafeImageUrl(rawUrl);

  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new UnsupportedImageError(`Failed to fetch image (HTTP ${response.status}): ${rawUrl}`);
  }

  const contentType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim();
  if (!ALLOWED_MIME_TYPES.has(contentType)) {
    throw new UnsupportedImageError(`Rejected non-image or unsupported content-type: ${contentType}`);
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_IMAGE_BYTES) {
    throw new UnsupportedImageError(`Image exceeds maximum allowed size (${MAX_IMAGE_BYTES} bytes)`);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
    throw new UnsupportedImageError(`Image exceeds maximum allowed size (${MAX_IMAGE_BYTES} bytes)`);
  }

  return { buffer: Buffer.from(arrayBuffer), contentType };
}

export interface SavedImage {
  relativePath: string; // servable path via the images route, e.g. "/api/images/{projectId}/{hash}.jpg"
  sha256: string;
  sizeBytes: number;
  deduped: boolean;
}

/**
 * Persists an already-validated image buffer under the project's local
 * storage directory, deduplicating by SHA-256 (Technical Plan §14, §49).
 * Pure function over bytes — no network access — so it is fully unit
 * testable without depending on any external URL being reachable.
 */
export async function saveImageToProject(
  buffer: Buffer,
  contentType: string,
  projectId: string,
  uploadsRoot: string
): Promise<SavedImage> {
  if (buffer.length === 0) {
    throw new UnsupportedImageError("Refusing to save an empty image");
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new UnsupportedImageError(`Image exceeds maximum allowed size (${MAX_IMAGE_BYTES} bytes)`);
  }

  const extension = extensionForMime(contentType);
  const hash = sha256(buffer);
  const projectDir = path.join(uploadsRoot, projectId);
  const filePath = path.join(projectDir, `${hash}${extension}`);
  const relativePath = `/api/images/${projectId}/${hash}${extension}`;

  const alreadyExists = await stat(filePath)
    .then(() => true)
    .catch(() => false);

  if (!alreadyExists) {
    await mkdir(projectDir, { recursive: true });
    await writeFile(filePath, buffer);
  }

  return { relativePath, sha256: hash, sizeBytes: buffer.length, deduped: alreadyExists };
}

export function validateUploadedImageMimeType(mimeType: string): void {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new UnsupportedImageError(`Unsupported image type: ${mimeType}`);
  }
}

export { MAX_IMAGE_BYTES };
