import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_BRAND_PROFILE, type BrandProfile } from "./types";

/** Single global record — a validated, deliberately simple choice (spec: don't overbuild white-label SaaS). */
export class BrandProfileStore {
  constructor(private readonly dataRoot: string) {}

  private filePath(): string {
    return path.join(this.dataRoot, "brand-profile.json");
  }

  async get(): Promise<BrandProfile> {
    try {
      const raw = await readFile(this.filePath(), "utf-8");
      return { ...DEFAULT_BRAND_PROFILE, ...(JSON.parse(raw) as BrandProfile) };
    } catch {
      return DEFAULT_BRAND_PROFILE;
    }
  }

  async save(profile: BrandProfile): Promise<BrandProfile> {
    await mkdir(this.dataRoot, { recursive: true });
    await writeFile(this.filePath(), JSON.stringify(profile, null, 2));
    return profile;
  }
}
