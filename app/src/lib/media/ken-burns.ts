import { runFfmpeg } from "./ffmpeg-runner";
import { REEL_WIDTH, REEL_HEIGHT, REEL_FPS } from "./reel-assembler";

/** Oversized relative to the final 1080x1920 output so zoompan has headroom to zoom into without upscaling blur. */
const SUPERSAMPLE_WIDTH = REEL_WIDTH * 2;
const SUPERSAMPLE_HEIGHT = REEL_HEIGHT * 2;

interface MotionExpressions {
  zoom: string;
  x: string;
  y: string;
}

const CENTERED_X = "iw/2-(iw/zoom/2)";
const CENTERED_Y = "ih/2-(ih/zoom/2)";

/**
 * Smoothstep-eased progress (0→1) instead of raw linear `on/d`. A camera
 * that moves at constant velocity reads as mechanical/robotic — real
 * cinematography (and Higgsfield's AI-generated clips) eases in and out.
 * `t*t*(3-2*t)` is the standard smoothstep curve; only +,-,*,/ are used so
 * it's valid inside ffmpeg's expression evaluator without needing pow().
 */
function eased(frames: number): string {
  const t = `(on/${frames})`;
  return `(${t}*${t}*(3-2*${t}))`;
}

/**
 * Maps each storyboard camera-motion label to a zoompan zoom/x/y expression
 * triple, given the clip's total output frame count. `d` (the zoompan
 * option controlling frame-hold count) is NOT readable inside the z/x/y
 * expressions themselves — only `on` (current output frame) is — so the
 * frame-count denominator must be inlined as a literal here rather than
 * referenced symbolically. These are deliberately simple, deterministic
 * functions of `on` — no randomness, no true 3D parallax/orbit (impossible
 * from a single flat photo), just the closest tasteful 2D approximation
 * for each label. Falls back to a subtle static-ish zoom for any
 * unrecognized motion string.
 */
const MOTION_PRESETS: Record<string, (frames: number) => MotionExpressions> = {
  push_in: (d) => ({ zoom: `1+0.12*${eased(d)}`, x: CENTERED_X, y: CENTERED_Y }),
  pull_back: (d) => ({ zoom: `1.12-0.12*${eased(d)}`, x: CENTERED_X, y: CENTERED_Y }),
  dolly_forward: (d) => ({ zoom: `1+0.16*${eased(d)}`, x: CENTERED_X, y: CENTERED_Y }),
  pan_right: (d) => ({ zoom: "1.08", x: `(iw-iw/zoom)*${eased(d)}`, y: CENTERED_Y }),
  pan_left: (d) => ({ zoom: "1.08", x: `(iw-iw/zoom)*(1-${eased(d)})`, y: CENTERED_Y }),
  subtle_parallax: (d) => ({
    zoom: `1.06+0.02*${eased(d)}`,
    x: `(iw-iw/zoom)*(0.4+0.2*${eased(d)})`,
    y: `(ih-ih/zoom)*(0.4+0.2*${eased(d)})`,
  }),
  gentle_orbit: (d) => ({
    zoom: `1.1-0.05*${eased(d)}`,
    x: `(iw-iw/zoom)*${eased(d)}`,
    y: CENTERED_Y,
  }),
  static: () => ({ zoom: "1.03", x: CENTERED_X, y: CENTERED_Y }),
};

const DEFAULT_PRESET = MOTION_PRESETS.static!;

/**
 * Cinematic finishing pass applied after the pan/zoom: mild contrast +
 * saturation lift and a deepened gamma so the image reads as "graded"
 * rather than a flat phone photo, a natural vignette (classic cinematic
 * cue), and very light film-style grain so a static-ish shot doesn't look
 * digitally dead. Deliberately restrained — real-estate marketing needs
 * the property's actual colors/materials to stay honest, not a stylized
 * teal-orange film look, so this stays well short of that.
 */
const CINEMATIC_GRADE = ["eq=contrast=1.08:saturation=1.12:gamma=0.97", "vignette=PI/5", "noise=alls=8:allf=t+u"].join(
  ","
);

/**
 * Renders a "Ken Burns" pan/zoom clip from a single still photo — a
 * fallback scene source that needs no external video-generation provider.
 * Output already matches the reel's canonical format (1080x1920, 30fps,
 * h264/yuv420p), so it can be fed straight into `assembleReel`'s existing
 * `normalizeClip` step exactly like a downloaded Higgsfield clip.
 */
export async function renderKenBurnsClip(
  imagePath: string,
  outputPath: string,
  options: { cameraMotion: string; durationSeconds: number }
): Promise<void> {
  const frames = Math.max(1, Math.round(options.durationSeconds * REEL_FPS));
  const preset = (MOTION_PRESETS[options.cameraMotion] ?? DEFAULT_PRESET)(frames);

  const filter = [
    `scale=${SUPERSAMPLE_WIDTH}:${SUPERSAMPLE_HEIGHT}:force_original_aspect_ratio=increase`,
    `crop=${SUPERSAMPLE_WIDTH}:${SUPERSAMPLE_HEIGHT}`,
    `zoompan=z='${preset.zoom}':x='${preset.x}':y='${preset.y}':d=${frames}:s=${REEL_WIDTH}x${REEL_HEIGHT}:fps=${REEL_FPS}`,
    CINEMATIC_GRADE,
    "format=yuv420p",
  ].join(",");

  await runFfmpeg([
    "-loop",
    "1",
    "-i",
    imagePath,
    "-t",
    String(options.durationSeconds),
    "-vf",
    filter,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    outputPath,
  ]);
}
