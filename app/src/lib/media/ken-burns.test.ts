import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { renderKenBurnsClip } from "./ken-burns";
import { probeMedia, FFmpegError } from "./ffmpeg-runner";
import { REEL_WIDTH, REEL_HEIGHT } from "./reel-assembler";

const execFileAsync = promisify(execFile);

/**
 * Integration tests using the REAL ffmpeg binary (see reel-assembler.test.ts
 * for the same rationale) — this module is a zoompan expression builder
 * around a subprocess call, so mocking ffmpeg would test nothing real.
 */
describe("ken-burns (real ffmpeg)", () => {
  let workDir: string;
  let samplePhoto: string;

  beforeAll(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "pmg-kenburns-test-"));
    samplePhoto = path.join(workDir, "sample.jpg");
    await execFileAsync("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "testsrc2=size=1600x1067:rate=1",
      "-frames:v", "1",
      samplePhoto,
    ]);
  }, 30000);

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it(
    "renders every known camera motion to the canonical reel format at the requested duration",
    async () => {
      const motions = [
        "push_in",
        "pull_back",
        "pan_left",
        "pan_right",
        "dolly_forward",
        "subtle_parallax",
        "gentle_orbit",
        "static",
      ];

      for (const cameraMotion of motions) {
        const outputPath = path.join(workDir, `${cameraMotion}.mp4`);
        await renderKenBurnsClip(samplePhoto, outputPath, { cameraMotion, durationSeconds: 3 });

        const probe = await probeMedia(outputPath);
        expect(probe.widthPx).toBe(REEL_WIDTH);
        expect(probe.heightPx).toBe(REEL_HEIGHT);
        expect(probe.videoCodec).toBe("h264");
        expect(probe.durationSeconds).toBeGreaterThan(2.7);
        expect(probe.durationSeconds).toBeLessThan(3.3);
      }
    },
    150000
  );

  it(
    "falls back to a static-like render for an unrecognized camera motion instead of throwing",
    async () => {
      const outputPath = path.join(workDir, "unknown-motion.mp4");
      await renderKenBurnsClip(samplePhoto, outputPath, {
        cameraMotion: "not_a_real_motion",
        durationSeconds: 2,
      });

      const probe = await probeMedia(outputPath);
      expect(probe.widthPx).toBe(REEL_WIDTH);
      expect(probe.heightPx).toBe(REEL_HEIGHT);
    },
    20000
  );

  it("rejects when the source image does not exist", async () => {
    await expect(
      renderKenBurnsClip(path.join(workDir, "does-not-exist.jpg"), path.join(workDir, "out.mp4"), {
        cameraMotion: "push_in",
        durationSeconds: 3,
      })
    ).rejects.toBeInstanceOf(FFmpegError);
  });
});
