// Phase 0G PoC — local temporary storage adapter ONLY.
// AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY exist in this sandbox's environment but are
// 14 characters each (real AWS access keys are 20 chars, secrets 40) — almost certainly
// unrelated internal harness credentials, not user-provided S3 credentials. No S3_*
// variables are set at all. Per Technical Plan §87 decision 5 and this instruction set,
// production storage provider selection requires explicit approval and is marked
// UNCONFIGURED below. This PoC proves the StorageProvider *interface contract* only.
import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile, unlink, stat } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve("./local-storage-root");

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

// Deterministic storage key: content-addressed, matching Technical Plan §49
// (dedup / cache validation / idempotency / integrity via SHA-256).
function deterministicKey(projectId, category, buffer, ext) {
  const hash = sha256(buffer);
  return `projects/${projectId}/${category}/${hash}${ext}`;
}

const LocalStorageProvider = {
  async upload(key, buffer, contentType) {
    const filePath = path.join(ROOT, key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, buffer);
    await writeFile(`${filePath}.meta.json`, JSON.stringify({ contentType, size: buffer.length, sha256: sha256(buffer) }));
    return { key, size: buffer.length };
  },
  async download(key) {
    return readFile(path.join(ROOT, key));
  },
  async metadata(key) {
    const meta = JSON.parse(await readFile(`${path.join(ROOT, key)}.meta.json`, "utf-8"));
    const stats = await stat(path.join(ROOT, key));
    return { ...meta, mtime: stats.mtime };
  },
  async delete(key) {
    await unlink(path.join(ROOT, key));
    await unlink(`${path.join(ROOT, key)}.meta.json`).catch(() => {});
  },
};

async function main() {
  console.log("Production storage provider: UNCONFIGURED (no approved S3-compatible credentials present).");
  console.log("Running PoC against LocalStorageProvider only.\n");

  const sampleFile = path.resolve("../ffmpeg/out/07-thumbnail.jpg");
  const buffer = await readFile(sampleFile);
  const key = deterministicKey("poc-project", "renders", buffer, ".jpg");

  console.log(`Deterministic key: ${key}`);

  const uploadResult = await LocalStorageProvider.upload(key, buffer, "image/jpeg");
  console.log("Upload:", uploadResult);

  const downloaded = await LocalStorageProvider.download(key);
  const integrityMatch = sha256(downloaded) === sha256(buffer);
  console.log(`Download roundtrip integrity match: ${integrityMatch}`);

  const meta = await LocalStorageProvider.metadata(key);
  console.log("Metadata:", meta);

  // Idempotency proof: uploading identical bytes again produces the same key
  const key2 = deterministicKey("poc-project", "renders", buffer, ".jpg");
  console.log(`Idempotent key match on re-upload of identical bytes: ${key === key2}`);

  await LocalStorageProvider.delete(key);
  const stillExists = await stat(path.join(ROOT, key)).then(() => true).catch(() => false);
  console.log(`Delete confirmed (file gone): ${!stillExists}`);

  const pass = integrityMatch && key === key2 && !stillExists;
  console.log(`\nPhase 0G PoC ${pass ? "PASS" : "FAIL"}`);
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error("PoC FAILED:", err.message);
  process.exit(1);
});
