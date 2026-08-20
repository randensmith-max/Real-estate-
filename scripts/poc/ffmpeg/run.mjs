// Phase 0F PoC — proves each required ffmpeg operation using safe argument arrays
// (execFile, never a concatenated shell string), per Technical Plan §76.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

const run = promisify(execFile);
const SRC = path.resolve(
  "../hyperframes-test/renders",
  process.argv[2] || "hyperframes-test_2026-08-20_06-12-38.mp4"
);
const OUT_DIR = path.resolve("./out");

async function ffmpeg(args, label) {
  const start = Date.now();
  await run("ffmpeg", ["-y", ...args]);
  console.log(`[ok] ${label} (${Date.now() - start}ms)`);
}

async function ffprobeJson(file) {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    file,
  ]);
  return JSON.parse(stdout);
}

async function main() {
  if (!existsSync(SRC)) {
    console.error(`Source clip not found: ${SRC}`);
    process.exit(1);
  }
  await run("mkdir", ["-p", OUT_DIR]);

  // 1. ffprobe inspection of the source
  const srcProbe = await ffprobeJson(SRC);
  console.log("\n[1] ffprobe (source):", {
    codec: srcProbe.streams[0].codec_name,
    width: srcProbe.streams[0].width,
    height: srcProbe.streams[0].height,
    fps: srcProbe.streams[0].r_frame_rate,
    duration: srcProbe.format.duration,
  });

  // 2. resize to 1080x1920 (9:16) with letterboxing (source is 16:9 landscape)
  const resized = path.join(OUT_DIR, "02-resized-1080x1920.mp4");
  await ffmpeg(
    [
      "-i", SRC,
      "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black",
      "-c:v", "libx264",
      resized,
    ],
    "2. resize to 1080x1920"
  );

  // 3. frame-rate normalization to 30fps
  const fps30 = path.join(OUT_DIR, "03-30fps.mp4");
  await ffmpeg(["-i", resized, "-r", "30", "-c:v", "libx264", fps30], "3. normalize to 30fps");

  // 4. H.264 encoding + AAC audio (generate a silent tone track to prove audio muxing,
  //    since the HyperFrames source clip has no audio stream)
  const withAudio = path.join(OUT_DIR, "04-h264-aac.mp4");
  await ffmpeg(
    [
      "-i", fps30,
      "-f", "lavfi",
      "-i", "sine=frequency=220:sample_rate=44100",
      "-shortest",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "128k",
      withAudio,
    ],
    "4. H.264 + AAC mux"
  );

  // 5. trim (first 3 seconds)
  const trimmed = path.join(OUT_DIR, "05-trimmed-3s.mp4");
  await ffmpeg(
    ["-i", withAudio, "-t", "3", "-c:v", "libx264", "-c:a", "aac", trimmed],
    "5. trim to 3s"
  );

  // 6. fade in/out (video + audio)
  const faded = path.join(OUT_DIR, "06-faded.mp4");
  await ffmpeg(
    [
      "-i", trimmed,
      "-vf", "fade=t=in:st=0:d=0.5,fade=t=out:st=2.3:d=0.5",
      "-af", "afade=t=in:st=0:d=0.5,afade=t=out:st=2.3:d=0.5",
      "-c:v", "libx264",
      "-c:a", "aac",
      faded,
    ],
    "6. fade in/out"
  );

  // 7. thumbnail extraction
  const thumb = path.join(OUT_DIR, "07-thumbnail.jpg");
  await ffmpeg(["-i", faded, "-ss", "1", "-frames:v", "1", thumb], "7. thumbnail extraction");

  // Final validation of the fully processed output
  const finalProbe = await ffprobeJson(faded);
  const videoStream = finalProbe.streams.find((s) => s.codec_type === "video");
  const audioStream = finalProbe.streams.find((s) => s.codec_type === "audio");

  console.log("\n=== FINAL OUTPUT VALIDATION (06-faded.mp4) ===");
  console.log({
    videoCodec: videoStream.codec_name,
    pixFmt: videoStream.pix_fmt,
    width: videoStream.width,
    height: videoStream.height,
    fps: videoStream.r_frame_rate,
    audioCodec: audioStream?.codec_name,
    duration: finalProbe.format.duration,
    sizeBytes: statSync(faded).size,
  });

  const thumbStat = statSync(thumb);
  console.log(`Thumbnail: ${thumb} (${thumbStat.size} bytes)`);

  console.log("\nPhase 0F PoC PASS — all 7 operations completed successfully.");
}

main().catch((err) => {
  console.error("PoC FAILED:", err.message);
  process.exit(1);
});
