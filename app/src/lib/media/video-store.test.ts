import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { saveVideoToProject, UnsupportedVideoError } from "./video-store";
import { sha256 } from "./image-store";

describe("saveVideoToProject", () => {
  let videosRoot: string;
  let projectId: string;

  beforeEach(async () => {
    videosRoot = await mkdtemp(path.join(tmpdir(), "pmg-videos-test-"));
    projectId = randomUUID();
  });

  afterEach(async () => {
    await rm(videosRoot, { recursive: true, force: true });
  });

  it("saves video bytes and returns a servable /api/videos path", async () => {
    const buffer = Buffer.from("fake-mp4-bytes");
    const result = await saveVideoToProject(buffer, projectId, videosRoot);

    expect(result.relativePath).toBe(`/api/videos/${projectId}/${sha256(buffer)}.mp4`);
    const onDisk = await readFile(path.join(videosRoot, projectId, `${sha256(buffer)}.mp4`));
    expect(onDisk.equals(buffer)).toBe(true);
  });

  it("rejects an empty buffer", async () => {
    await expect(saveVideoToProject(Buffer.alloc(0), projectId, videosRoot)).rejects.toBeInstanceOf(
      UnsupportedVideoError
    );
  });
});
