import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, copyFile, writeFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { BrandProfile } from "../brand/types";
import { generateComposition, computeTimings, type ReelBrandingData } from "./hyperframes-composition";
import { probeMedia } from "./ffmpeg-runner";
import { REEL_WIDTH, REEL_HEIGHT } from "./reel-assembler";
import { UPLOADS_ROOT } from "../config/paths";

const execFileAsync = promisify(execFile);
const HYPERFRAMES_VERSION = "0.8.4"; // pinned — matches the version validated in Phase 0

export class HyperFramesRenderError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "HyperFramesRenderError";
  }
}

export interface HyperFramesRenderInput {
  reelVideoPath: string;
  brand: BrandProfile;
  data: ReelBrandingData;
}

export interface HyperFramesRenderResult {
  outputPath: string;
}

/**
 * Renders deterministic branding (title/price/feature/closing cards) over
 * the plain FFmpeg-assembled reel via the HyperFrames CLI (ADR 0004).
 * `workDir` is a throwaway directory the caller creates/deletes around this
 * call — nothing here persists between renders.
 */
export async function renderBrandedReel(
  input: HyperFramesRenderInput,
  workDir: string
): Promise<HyperFramesRenderResult> {
  const probe = await probeMedia(input.reelVideoPath);
  const width = probe.widthPx ?? REEL_WIDTH;
  const height = probe.heightPx ?? REEL_HEIGHT;
  const timings = computeTimings(probe.durationSeconds, Boolean(input.data.featureCallout));

  await mkdir(workDir, { recursive: true });
  await writeFile(path.join(workDir, "package.json"), JSON.stringify(packageJson(), null, 2));
  await writeFile(path.join(workDir, "hyperframes.json"), JSON.stringify(hyperframesJson(), null, 2));

  const assetsDir = path.join(workDir, "assets");
  const vendorDir = path.join(workDir, "vendor");
  await mkdir(assetsDir, { recursive: true });
  await mkdir(vendorDir, { recursive: true });

  await copyFile(input.reelVideoPath, path.join(assetsDir, "reel.mp4"));

  const gsapSource = path.join(process.cwd(), "node_modules", "gsap", "dist", "gsap.min.js");
  await copyFile(gsapSource, path.join(vendorDir, "gsap.min.js"));

  if (input.brand.logoPath) {
    try {
      const logoAbsolutePath = resolveServedAssetPath(input.brand.logoPath);
      const ext = path.extname(logoAbsolutePath);
      await copyFile(logoAbsolutePath, path.join(assetsDir, `logo${ext}`));
    } catch {
      // Logo missing/unreadable — render without it rather than failing the whole branding step.
    }
  }

  const html = generateComposition(input.brand, input.data, timings, width, height);
  await writeFile(path.join(workDir, "index.html"), html);

  try {
    await execFileAsync("npx", ["--yes", `hyperframes@${HYPERFRAMES_VERSION}`, "render"], {
      cwd: workDir,
      maxBuffer: 1024 * 1024 * 64,
      timeout: 120000,
    });
  } catch (error) {
    throw new HyperFramesRenderError(`HyperFrames render failed: ${(error as Error).message}`, error);
  }

  const rendersDir = path.join(workDir, "renders");
  const outputPath = await findNewestMp4(rendersDir);
  if (!outputPath) {
    throw new HyperFramesRenderError("HyperFrames render completed but produced no output file.");
  }

  return { outputPath };
}

async function findNewestMp4(dir: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  const mp4s = entries.filter((f) => f.endsWith(".mp4"));
  if (mp4s.length === 0) return null;

  const withStats = await Promise.all(
    mp4s.map(async (f) => ({ file: f, mtime: (await stat(path.join(dir, f))).mtimeMs }))
  );
  withStats.sort((a, b) => b.mtime - a.mtime);
  return path.join(dir, withStats[0]!.file);
}

/** Maps a servable `/api/images/...` path back to its absolute file location under UPLOADS_ROOT. */
function resolveServedAssetPath(servedPath: string): string {
  const parts = servedPath.split("/").filter(Boolean); // ["api", "images", projectId, filename]
  const [, , projectId, filename] = parts;
  return path.join(UPLOADS_ROOT, projectId!, filename!);
}

function packageJson() {
  return {
    name: "branded-reel",
    private: true,
    type: "module",
    scripts: {
      render: `npx --yes hyperframes@${HYPERFRAMES_VERSION} render`,
    },
  };
}

function hyperframesJson() {
  return {
    $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
    registry: "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
    paths: { blocks: "compositions", components: "compositions/components", assets: "assets" },
    media: { autoProxy: true },
  };
}
