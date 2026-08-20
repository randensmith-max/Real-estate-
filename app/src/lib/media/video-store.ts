import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { sha256 } from "./image-store";

const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100MB — generous for a few-second clip, guards against runaway downloads

export class UnsupportedVideoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedVideoError";
  }
}

/**
 * Persists a downloaded generated clip under the project's private video
 * directory (never `public/` — same reasoning as ADR 0002 for images),
 * deduplicated by SHA-256. Pure function over bytes.
 */
export async function saveVideoToProject(
  buffer: Buffer,
  projectId: string,
  videosRoot: string
): Promise<{ relativePath: string; sha256: string; sizeBytes: number }> {
  if (buffer.length === 0) {
    throw new UnsupportedVideoError("Refusing to save an empty video");
  }
  if (buffer.length > MAX_VIDEO_BYTES) {
    throw new UnsupportedVideoError(`Video exceeds maximum allowed size (${MAX_VIDEO_BYTES} bytes)`);
  }

  const hash = sha256(buffer);
  const projectDir = path.join(videosRoot, projectId);
  const filePath = path.join(projectDir, `${hash}.mp4`);
  const relativePath = `/api/videos/${projectId}/${hash}.mp4`;

  await mkdir(projectDir, { recursive: true });
  await writeFile(filePath, buffer);

  return { relativePath, sha256: hash, sizeBytes: buffer.length };
}
