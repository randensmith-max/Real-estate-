import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const FFMPEG_PATH = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE_PATH = process.env.FFPROBE_PATH || "ffprobe";

export class FFmpegError extends Error {
  constructor(
    message: string,
    public readonly stderr?: string
  ) {
    super(message);
    this.name = "FFmpegError";
  }
}

/**
 * Runs ffmpeg with an argument ARRAY only — never a concatenated shell
 * string built from user-controlled values (spec's explicit FFmpeg
 * security requirement). `execFile` does not invoke a shell, so this is
 * not vulnerable to argument injection even if a caller passed a
 * maliciously-crafted string into one array element.
 */
export async function runFfmpeg(args: string[]): Promise<void> {
  try {
    await execFileAsync(FFMPEG_PATH, ["-y", "-hide_banner", "-loglevel", "error", ...args], {
      maxBuffer: 1024 * 1024 * 64,
    });
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr;
    throw new FFmpegError(`ffmpeg failed: ${(error as Error).message}`, stderr);
  }
}

export interface MediaProbeResult {
  videoCodec: string | null;
  audioCodec: string | null;
  widthPx: number | null;
  heightPx: number | null;
  fps: number | null;
  durationSeconds: number;
  sizeBytes: number;
}

interface FfprobeStream {
  codec_type: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
}
interface FfprobeOutput {
  streams: FfprobeStream[];
  format: { duration?: string; size?: string };
}

function parseFrameRate(rate: string | undefined): number | null {
  if (!rate) return null;
  const [num, den] = rate.split("/").map(Number);
  if (!num || !den) return null;
  return num / den;
}

export async function probeMedia(filePath: string): Promise<MediaProbeResult> {
  let stdout: string;
  try {
    const result = await execFileAsync(FFPROBE_PATH, [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath,
    ]);
    stdout = result.stdout;
  } catch (error) {
    throw new FFmpegError(`ffprobe failed: ${(error as Error).message}`);
  }

  const parsed = JSON.parse(stdout) as FfprobeOutput;
  const videoStream = parsed.streams.find((s) => s.codec_type === "video");
  const audioStream = parsed.streams.find((s) => s.codec_type === "audio");

  return {
    videoCodec: videoStream?.codec_name ?? null,
    audioCodec: audioStream?.codec_name ?? null,
    widthPx: videoStream?.width ?? null,
    heightPx: videoStream?.height ?? null,
    fps: parseFrameRate(videoStream?.r_frame_rate),
    durationSeconds: Number(parsed.format.duration ?? 0),
    sizeBytes: Number(parsed.format.size ?? 0),
  };
}
