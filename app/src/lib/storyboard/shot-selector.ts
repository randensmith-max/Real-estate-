import type { ImageAnalysis } from "../vision/schema";

const MIN_SHOTS = 6;
const MAX_SHOTS = 10;
const MAX_PER_ROOM_TYPE = 2;

/** Roughly the order a viewer would tour a home in — only reorders room types actually present. */
const NARRATIVE_ROOM_ORDER: readonly ImageAnalysis["roomType"][] = [
  "exterior",
  "living_room",
  "kitchen",
  "dining_room",
  "bedroom",
  "bathroom",
  "office",
  "hallway",
  "garage",
  "garden",
  "patio",
  "balcony",
  "view",
  "other",
];

function compositeScore(analysis: ImageAnalysis): number {
  return (analysis.visualQualityScore + analysis.marketingValueScore + analysis.cinematicPotentialScore) / 3;
}

/**
 * Selects and orders ~6-10 shots for the reel (spec: "select approximately
 * 6-10 photos depending on listing size... avoid repetitive rooms... rank
 * by visual quality, marketing importance, cinematic potential, variety,
 * narrative flow"). Two-pass: rank by composite score with a per-room-type
 * cap to guarantee variety, then reorder the selection into a natural
 * walkthrough sequence — never forcing room types the property doesn't have.
 */
export function selectShots(analyses: ImageAnalysis[]): ImageAnalysis[] {
  const candidates = analyses.filter((a) => a.useInReel);
  const ranked = [...candidates].sort((a, b) => compositeScore(b) - compositeScore(a));

  const targetCount = Math.min(MAX_SHOTS, Math.max(MIN_SHOTS, ranked.length));

  // The room-diversity cap is never relaxed to hit MIN_SHOTS — a listing
  // with eight bedroom photos and nothing else must NOT produce a reel
  // padded with repetitive bedroom shots just to reach a target count.
  // A shorter, more varied reel is the correct trade-off (spec's own
  // example: eight bedroom photos should not become five bedroom shots).
  const selected: ImageAnalysis[] = [];
  const perRoomCount = new Map<string, number>();

  for (const analysis of ranked) {
    if (selected.length >= targetCount) break;
    const usedForRoom = perRoomCount.get(analysis.roomType) ?? 0;
    if (usedForRoom >= MAX_PER_ROOM_TYPE) continue;
    selected.push(analysis);
    perRoomCount.set(analysis.roomType, usedForRoom + 1);
  }

  return selected.sort((a, b) => {
    const orderA = NARRATIVE_ROOM_ORDER.indexOf(a.roomType);
    const orderB = NARRATIVE_ROOM_ORDER.indexOf(b.roomType);
    if (orderA !== orderB) return orderA - orderB;
    return compositeScore(b) - compositeScore(a);
  });
}
