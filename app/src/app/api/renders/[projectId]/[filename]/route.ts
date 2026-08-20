import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { RENDERS_ROOT } from "@/lib/config/paths";

const SAFE_SEGMENT = /^[a-zA-Z0-9._-]+$/;
const CONTENT_TYPES: Record<string, string> = { ".mp4": "video/mp4", ".jpg": "image/jpeg" };

/** Serves final reel/thumbnail outputs saved under RENDERS_ROOT. Same protections as the images/videos routes. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; filename: string }> }
): Promise<Response> {
  const { projectId, filename } = await params;

  const contentType = CONTENT_TYPES[path.extname(filename)];
  if (!SAFE_SEGMENT.test(projectId) || !SAFE_SEGMENT.test(filename) || !contentType) {
    return new Response("Not found", { status: 404 });
  }

  const filePath = path.join(RENDERS_ROOT, projectId, filename);
  const resolvedRoot = path.resolve(RENDERS_ROOT);
  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(resolvedRoot + path.sep)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    await stat(resolvedPath);
    const buffer = await readFile(resolvedPath);
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: { "Content-Type": contentType, "Content-Disposition": `attachment; filename="${filename}"` },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
