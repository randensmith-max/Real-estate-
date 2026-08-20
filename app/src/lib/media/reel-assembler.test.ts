import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  normalizeClip,
  concatenateClips,
  addMusic,
  extractThumbnail,
  assembleReel,
  REEL_WIDTH,
  REEL_HEIGHT,
} from "./reel-assembler";
import { probeMedia, FFmpegError } from "./ffmpeg-runner";

const execFileAsync = promisify(execFile);

/**
 * Integration tests using the REAL ffmpeg/ffprobe binaries (confirmed
 * present since Phase 0) — this module is almost entirely a thin,
 * safety-conscious wrapper around ffmpeg subprocess calls, so mocking it
 * would test very little. Fixture clips are generated with lavfi test
 * sources (no external assets needed).
 */
describe("reel-assembler (real ffmpeg)", () => {
  let workDir: string;

  beforeAll(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "pmg-reel-test-"));
  }, 30000);

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  async function makeTestClip(name: string, color: string, seconds: number, withAudio = false): Promise<string> {
    const outputPath = path.join(workDir, name);
    const args = ["-y", "-hide_banner", "-loglevel", "error"];
    args.push("-f", "lavfi", "-i", `color=c=${color}:s=640x480:d=${seconds}`);
    if (withAudio) {
      args.push("-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`);
    }
    args.push("-c:v", "libx264", "-pix_fmt", "yuv420p");
    if (withAudio) args.push("-c:a", "aac");
    args.push(outputPath);
    await execFileAsync("ffmpeg", args);
    return outputPath;
  }

  it(
    "normalizeClip scales/pads a landscape clip to 1080x1920 and adds a silent audio track",
    async () => {
      const source = await makeTestClip("landscape.mp4", "red", 2);
      const output = path.join(workDir, "normalized-landscape.mp4");

      await normalizeClip(source, output, { fadeIn: false, fadeOut: false });

      const probe = await probeMedia(output);
      expect(probe.widthPx).toBe(REEL_WIDTH);
      expect(probe.heightPx).toBe(REEL_HEIGHT);
      expect(probe.videoCodec).toBe("h264");
      expect(probe.audioCodec).toBe("aac");
    },
    20000
  );

  it(
    "concatenateClips joins normalized clips into one file with combined duration",
    async () => {
      const clipA = path.join(workDir, "concat-a.mp4");
      const clipB = path.join(workDir, "concat-b.mp4");
      await normalizeClip(await makeTestClip("src-a.mp4", "blue", 1), clipA, { fadeIn: false, fadeOut: true });
      await normalizeClip(await makeTestClip("src-b.mp4", "green", 1), clipB, { fadeIn: true, fadeOut: false });

      const output = path.join(workDir, "concatenated-test.mp4");
      await concatenateClips([clipA, clipB], output, workDir);

      const probe = await probeMedia(output);
      expect(probe.durationSeconds).toBeGreaterThan(1.7); // ~2s combined, allowing encoder rounding
      expect(probe.durationSeconds).toBeLessThan(2.3);
    },
    20000
  );

  it(
    "addMusic with no music path just copies the video through unchanged",
    async () => {
      const source = path.join(workDir, "no-music-source.mp4");
      await normalizeClip(await makeTestClip("src-c.mp4", "yellow", 1), source, { fadeIn: false, fadeOut: false });
      const output = path.join(workDir, "no-music-output.mp4");

      await addMusic(source, null, output);

      const probe = await probeMedia(output);
      expect(probe.videoCodec).toBe("h264");
      expect(probe.audioCodec).toBe("aac");
    },
    20000
  );

  it(
    "addMusic mixes, trims, and loudness-normalizes a real audio track under the video",
    async () => {
      const source = path.join(workDir, "with-music-source.mp4");
      await normalizeClip(await makeTestClip("src-d.mp4", "purple", 2), source, { fadeIn: false, fadeOut: false });

      const musicPath = path.join(workDir, "music.wav");
      await execFileAsync("ffmpeg", [
        "-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", "sine=frequency=220:duration=5",
        musicPath,
      ]);

      const output = path.join(workDir, "with-music-output.mp4");
      await addMusic(source, musicPath, output);

      const probe = await probeMedia(output);
      expect(probe.audioCodec).toBe("aac");
      // Music track (5s) must be trimmed down to the video's duration (~2s), not left at 5s.
      expect(probe.durationSeconds).toBeLessThan(2.5);
    },
    20000
  );

  it(
    "extractThumbnail produces a valid single-frame JPEG",
    async () => {
      const source = path.join(workDir, "thumb-source.mp4");
      await normalizeClip(await makeTestClip("src-e.mp4", "orange", 1), source, { fadeIn: false, fadeOut: false });
      const output = path.join(workDir, "thumb.jpg");

      await extractThumbnail(source, output, 0.2);

      const probe = await probeMedia(output);
      expect(probe.videoCodec).toBe("mjpeg");
    },
    20000
  );

  it(
    "assembleReel runs the full pipeline end to end and produces a validated final reel",
    async () => {
      const clip1 = await makeTestClip("full-1.mp4", "red", 2);
      const clip2 = await makeTestClip("full-2.mp4", "blue", 2);
      const clip3 = await makeTestClip("full-3.mp4", "green", 2);

      const outputDir = path.join(workDir, "full-pipeline-output");
      const result = await assembleReel(
        [
          { videoPath: clip1, durationSeconds: 2 },
          { videoPath: clip2, durationSeconds: 2 },
          { videoPath: clip3, durationSeconds: 2 },
        ],
        path.join(workDir, "full-pipeline-work"),
        outputDir
      );

      const reelProbe = await probeMedia(result.reelPath);
      expect(reelProbe.widthPx).toBe(REEL_WIDTH);
      expect(reelProbe.heightPx).toBe(REEL_HEIGHT);
      expect(reelProbe.videoCodec).toBe("h264");
      expect(reelProbe.audioCodec).toBe("aac");
      expect(reelProbe.durationSeconds).toBeGreaterThan(5); // ~6s combined

      const thumbProbe = await probeMedia(result.thumbnailPath);
      expect(thumbProbe.videoCodec).toBe("mjpeg");
    },
    60000
  );

  it("assembleReel rejects an empty scene list rather than producing a bogus file", async () => {
    await expect(assembleReel([], path.join(workDir, "empty-work"), path.join(workDir, "empty-out"))).rejects.toBeInstanceOf(
      FFmpegError
    );
  });
});
