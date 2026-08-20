import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ImportedListing } from "../listing/types";

export type ProjectSourceType = "url_import" | "manual_upload";

export interface ProjectRecord {
  id: string;
  createdAt: string;
  sourceType: ProjectSourceType;
  listing: ImportedListing;
}

/**
 * Minimal local-disk persistence for Phase 1 (Technical Plan Phase-1
 * instruction: do not add PostgreSQL unless absolutely required — a single
 * lean product with no multi-tenant/queue needs does not require it yet).
 * Each project is one JSON file; images referenced by `listing.imageUrls`
 * live alongside it under the public uploads directory.
 */
export class ProjectStore {
  constructor(private readonly dataRoot: string) {}

  private filePath(id: string): string {
    return path.join(this.dataRoot, `${id}.json`);
  }

  async create(sourceType: ProjectSourceType, listing: ImportedListing): Promise<ProjectRecord> {
    const record: ProjectRecord = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      sourceType,
      listing,
    };
    await this.save(record);
    return record;
  }

  /** Overwrites (or creates) the record for `record.id` — used to persist a project after its images finish saving. */
  async save(record: ProjectRecord): Promise<void> {
    await mkdir(this.dataRoot, { recursive: true });
    await writeFile(this.filePath(record.id), JSON.stringify(record, null, 2));
  }

  async get(id: string): Promise<ProjectRecord | null> {
    try {
      const raw = await readFile(this.filePath(id), "utf-8");
      return JSON.parse(raw) as ProjectRecord;
    } catch {
      return null;
    }
  }

  async list(): Promise<ProjectRecord[]> {
    try {
      const files = await readdir(this.dataRoot);
      const records = await Promise.all(
        files
          .filter((f) => f.endsWith(".json"))
          .map((f) => readFile(path.join(this.dataRoot, f), "utf-8").then((raw) => JSON.parse(raw) as ProjectRecord))
      );
      return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch {
      return [];
    }
  }
}
