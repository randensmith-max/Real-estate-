import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { UPLOADS_ROOT } from "@/lib/config/paths";

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const SAFE_SEGMENT = /^[a-zA-Z0-9._-]+$/;

/**
 * Serves images saved by `saveImageToProject`. Deliberately NOT `public/` —
 * see `lib/config/paths.ts` for why. `projectId` and `filename` are
 * validated against a strict allow-listed character set and resolved paths
 * are checked to stay inside `UPLOADS_ROOT` before any file read, since both
 * segments come directly from the URL (path-traversal surface).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; filename: string }> }
): Promise<Response> {
  const { projectId, filename } = await params;

  if (!SAFE_SEGMENT.test(projectId) || !SAFE_SEGMENT.test(filename)) {
    return new Response("Not found", { status: 404 });
  }

  const extension = path.extname(filename);
  const contentType = CONTENT_TYPE_BY_EXT[extension];
  if (!contentType) {
    return new Response("Not found", { status: 404 });
  }

  const filePath = path.join(UPLOADS_ROOT, projectId, filename);
  const resolvedRoot = path.resolve(UPLOADS_ROOT);
  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(resolvedRoot + path.sep)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    await stat(resolvedPath);
    const buffer = await readFile(resolvedPath);
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable", // content-addressed by sha256 -> safe to cache forever
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
