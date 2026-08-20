import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { VIDEOS_ROOT } from "@/lib/config/paths";

const SAFE_SEGMENT = /^[a-zA-Z0-9._-]+$/;

/** Serves generated clips saved by `saveVideoToProject`. Same rationale/protections as the images route (ADR 0002). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; filename: string }> }
): Promise<Response> {
  const { projectId, filename } = await params;

  if (!SAFE_SEGMENT.test(projectId) || !SAFE_SEGMENT.test(filename) || path.extname(filename) !== ".mp4") {
    return new Response("Not found", { status: 404 });
  }

  const filePath = path.join(VIDEOS_ROOT, projectId, filename);
  const resolvedRoot = path.resolve(VIDEOS_ROOT);
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
        "Content-Type": "video/mp4",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
