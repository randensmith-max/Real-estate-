import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ProjectStore } from "./project-store";
import type { ImportedListing } from "../listing/types";

const sampleListing: ImportedListing = {
  sourceUrl: "manual-upload",
  platform: "manual",
  address: "123 Main St",
  imageUrls: ["/uploads/x/a.jpg"],
};

describe("ProjectStore", () => {
  let dataRoot: string;
  let store: ProjectStore;

  beforeEach(async () => {
    dataRoot = await mkdtemp(path.join(tmpdir(), "pmg-projects-test-"));
    store = new ProjectStore(dataRoot);
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it("creates a project and can read it back", async () => {
    const created = await store.create("manual_upload", sampleListing);
    const fetched = await store.get(created.id);

    expect(fetched).not.toBeNull();
    expect(fetched?.listing.address).toBe("123 Main St");
    expect(fetched?.sourceType).toBe("manual_upload");
  });

  it("returns null for a project id that does not exist", async () => {
    expect(await store.get("does-not-exist")).toBeNull();
  });

  it("save() overwrites an existing record in place", async () => {
    const created = await store.create("manual_upload", sampleListing);
    await store.save({ ...created, listing: { ...sampleListing, address: "456 Updated Ave" } });

    const fetched = await store.get(created.id);
    expect(fetched?.listing.address).toBe("456 Updated Ave");
  });

  it("list() returns all created projects, newest first", async () => {
    const first = await store.create("manual_upload", sampleListing);
    await new Promise((r) => setTimeout(r, 5));
    const second = await store.create("manual_upload", sampleListing);

    const all = await store.list();
    expect(all.map((p) => p.id)).toEqual([second.id, first.id]);
  });
});
