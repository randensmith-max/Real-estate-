import { describe, it, expect } from "vitest";
import { buildHiggsfieldPrompt, PRESERVATION_INSTRUCTION } from "./prompt-generator";
import { CAMERA_MOTIONS } from "../vision/schema";

describe("buildHiggsfieldPrompt", () => {
  it("always includes the full preservation instruction verbatim", () => {
    for (const motion of CAMERA_MOTIONS) {
      expect(buildHiggsfieldPrompt(motion)).toContain(PRESERVATION_INSTRUCTION);
    }
  });

  it("preservation instruction forbids adding/removing/transforming objects and people", () => {
    expect(PRESERVATION_INSTRUCTION).toMatch(/do not add, remove, redesign/i);
    expect(PRESERVATION_INSTRUCTION).toMatch(/no people/i);
  });

  it("produces a distinct prompt per camera motion", () => {
    const prompts = CAMERA_MOTIONS.map(buildHiggsfieldPrompt);
    expect(new Set(prompts).size).toBe(CAMERA_MOTIONS.length);
  });

  it("avoids aggressive/surreal motion language regardless of selected motion", () => {
    for (const motion of CAMERA_MOTIONS) {
      const prompt = buildHiggsfieldPrompt(motion);
      expect(prompt).toMatch(/avoid large camera rotations/i);
    }
  });
});
