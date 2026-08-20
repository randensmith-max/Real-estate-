import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  saveImageToProject,
  sha256,
  validateUploadedImageMimeType,
  UnsupportedImageError,
} from "./image-store";

describe("saveImageToProject", () => {
  let uploadsRoot: string;
  let projectId: string;

  beforeEach(async () => {
    uploadsRoot = await mkdtemp(path.join(tmpdir(), "pmg-uploads-test-"));
    projectId = randomUUID();
  });

  afterEach(async () => {
    await rm(uploadsRoot, { recursive: true, force: true });
  });

  it("saves a valid JPEG and returns a web-servable relative path", async () => {
    const buffer = Buffer.from("fake-jpeg-bytes");
    const result = await saveImageToProject(buffer, "image/jpeg", projectId, uploadsRoot);

    expect(result.relativePath).toBe(`/api/images/${projectId}/${sha256(buffer)}.jpg`);
    expect(result.sizeBytes).toBe(buffer.length);
    expect(result.deduped).toBe(false);

    const onDisk = await readFile(path.join(uploadsRoot, projectId, `${sha256(buffer)}.jpg`));
    expect(onDisk.equals(buffer)).toBe(true);
  });

  it("deduplicates identical bytes uploaded twice for the same project", async () => {
    const buffer = Buffer.from("duplicate-content");
    const first = await saveImageToProject(buffer, "image/png", projectId, uploadsRoot);
    const second = await saveImageToProject(buffer, "image/png", projectId, uploadsRoot);

    expect(first.relativePath).toBe(second.relativePath);
    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
  });

  it("rejects an empty buffer", async () => {
    await expect(saveImageToProject(Buffer.alloc(0), "image/jpeg", projectId, uploadsRoot)).rejects.toBeInstanceOf(
      UnsupportedImageError
    );
  });

  it("rejects an unsupported content type", async () => {
    await expect(
      saveImageToProject(Buffer.from("x"), "application/pdf", projectId, uploadsRoot)
    ).rejects.toBeInstanceOf(UnsupportedImageError);
  });
});

describe("validateUploadedImageMimeType", () => {
  it("accepts jpeg/png/webp", () => {
    expect(() => validateUploadedImageMimeType("image/jpeg")).not.toThrow();
    expect(() => validateUploadedImageMimeType("image/png")).not.toThrow();
    expect(() => validateUploadedImageMimeType("image/webp")).not.toThrow();
  });

  it("rejects anything else", () => {
    expect(() => validateUploadedImageMimeType("application/pdf")).toThrow(UnsupportedImageError);
    expect(() => validateUploadedImageMimeType("text/html")).toThrow(UnsupportedImageError);
  });
});
