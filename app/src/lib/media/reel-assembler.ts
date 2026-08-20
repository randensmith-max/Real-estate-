import path from "node:path";
import { mkdir } from "node:fs/promises";
import { runFfmpeg, probeMedia, FFmpegError } from "./ffmpeg-runner";

export const REEL_WIDTH = 1080;
export const REEL_HEIGHT = 1920;
export const REEL_FPS = 30;
const FADE_SECONDS = 0.3;
const MIN_REEL_SECONDS = 20;
const MAX_REEL_SECONDS = 40;

export interface ReelScene {
  videoPath: string;
  durationSeconds: number;
}

export interface ReelAssemblyResult {
  reelPath: string;
  thumbnailPath: string;
  durationSeconds: number;
  totalSizeBytes: number;
  withinTargetDuration: boolean;
}

/**
 * Normalizes one clip to the canonical reel format (spec: 1080x1920, 30fps,
 * H.264) using scale+pad — never a naive stretch, so room proportions are
 * preserved (spec: "Do not stretch rooms unnaturally. Use intelligent
 * crop/pad"). Applies a restrained fade-to-black transition at scene
 * boundaries (spec's "subtle fade" option) — no fade-in on the first scene,
 * no fade-out on the last. Audio is always replaced with silence here
 * (source clips from image-to-video generation are silent camera moves);
 * real background music, if any, is mixed onto the whole assembled reel in
 * a later step, not per-clip.
 */
export async function normalizeClip(
  inputPath: string,
  outputPath: string,
  options: { fadeIn: boolean; fadeOut: boolean }
): Promise<void> {
  const probe = await probeMedia(inputPath);
  const duration = probe.durationSeconds;

  const filters = [
    `scale=${REEL_WIDTH}:${REEL_HEIGHT}:force_original_aspect_ratio=decrease`,
    `pad=${REEL_WIDTH}:${REEL_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black`,
    `fps=${REEL_FPS}`,
  ];
  if (options.fadeIn) filters.push(`fade=t=in:st=0:d=${FADE_SECONDS}`);
  if (options.fadeOut && duration > FADE_SECONDS) {
    filters.push(`fade=t=out:st=${Math.max(0, duration - FADE_SECONDS)}:d=${FADE_SECONDS}`);
  }

  await runFfmpeg([
    "-i",
    inputPath,
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=44100:cl=stereo",
    "-vf",
    filters.join(","),
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-shortest",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    outputPath,
  ]);
}

/**
 * Concatenates already-normalized clips (identical codec/resolution/fps —
 * required for the concat demuxer to work reliably) via a generated list
 * file. The list file path and its contents are entirely internally
 * generated (never user-controlled strings), per the FFmpeg security
 * requirement.
 */
export async function concatenateClips(clipPaths: string[], outputPath: string, workDir: string): Promise<void> {
  const { writeFile } = await import("node:fs/promises");
  const listPath = path.join(workDir, "concat-list.txt");
  const listContent = clipPaths.map((p) => `file '${path.resolve(p).replace(/'/g, "'\\''")}'`).join("\n");
  await writeFile(listPath, listContent);

  await runFfmpeg(["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputPath]);
}

/**
 * Mixes background music under the assembled reel: trimmed to the video's
 * duration, faded in/out, loudness-normalized (spec: trim/fade in/fade
 * out/volume/loudness normalization). If no music path is given, the
 * reel's existing (silent) audio track is kept as-is.
 */
export async function addMusic(videoPath: string, musicPath: string | null, outputPath: string): Promise<void> {
  if (!musicPath) {
    await runFfmpeg(["-i", videoPath, "-c", "copy", outputPath]);
    return;
  }

  const probe = await probeMedia(videoPath);
  const duration = probe.durationSeconds;
  const fadeOutStart = Math.max(0, duration - FADE_SECONDS);

  await runFfmpeg([
    "-i",
    videoPath,
    "-i",
    musicPath,
    "-filter_complex",
    `[1:a]atrim=0:${duration},afade=t=in:st=0:d=${FADE_SECONDS},afade=t=out:st=${fadeOutStart}:d=${FADE_SECONDS},loudnorm[music]`,
    "-map",
    "0:v",
    "-map",
    "[music]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-shortest",
    outputPath,
  ]);
}

export async function extractThumbnail(videoPath: string, outputPath: string, atSeconds = 0.5): Promise<void> {
  await runFfmpeg(["-i", videoPath, "-ss", String(atSeconds), "-frames:v", "1", outputPath]);
}

/**
 * Full pipeline: normalize each approved scene's clip in storyboard order,
 * concatenate, mix in optional music, extract a thumbnail, then validate
 * the final output with ffprobe before returning (spec: use FFprobe for
 * media validation — never hand back an unvalidated file).
 */
export async function assembleReel(
  scenes: ReelScene[],
  workDir: string,
  outputDir: string,
  musicPath: string | null = null
): Promise<ReelAssemblyResult> {
  if (scenes.length === 0) {
    throw new FFmpegError("Cannot assemble a reel with zero scenes.");
  }

  await mkdir(workDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });

  const normalizedPaths: string[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const normalizedPath = path.join(workDir, `normalized-${i}.mp4`);
    await normalizeClip(scenes[i]!.videoPath, normalizedPath, {
      fadeIn: i > 0,
      fadeOut: i < scenes.length - 1,
    });
    normalizedPaths.push(normalizedPath);
  }

  const concatenatedPath = path.join(workDir, "concatenated.mp4");
  await concatenateClips(normalizedPaths, concatenatedPath, workDir);

  const reelPath = path.join(outputDir, "final-reel.mp4");
  await addMusic(concatenatedPath, musicPath, reelPath);

  const thumbnailPath = path.join(outputDir, "thumbnail.jpg");
  await extractThumbnail(reelPath, thumbnailPath);

  const finalProbe = await probeMedia(reelPath);
  if (finalProbe.videoCodec !== "h264" || finalProbe.audioCodec !== "aac") {
    throw new FFmpegError(
      `Final reel failed validation: expected h264/aac, got ${finalProbe.videoCodec}/${finalProbe.audioCodec}.`
    );
  }
  if (finalProbe.widthPx !== REEL_WIDTH || finalProbe.heightPx !== REEL_HEIGHT) {
    throw new FFmpegError(
      `Final reel failed validation: expected ${REEL_WIDTH}x${REEL_HEIGHT}, got ${finalProbe.widthPx}x${finalProbe.heightPx}.`
    );
  }

  return {
    reelPath,
    thumbnailPath,
    durationSeconds: finalProbe.durationSeconds,
    totalSizeBytes: finalProbe.sizeBytes,
    withinTargetDuration:
      finalProbe.durationSeconds >= MIN_REEL_SECONDS - 2 && finalProbe.durationSeconds <= MAX_REEL_SECONDS + 2,
  };
}
