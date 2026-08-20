"use client";

import type { StoryboardScene } from "@/lib/storyboard/types";
import { CAMERA_MOTIONS } from "@/lib/vision/schema";

interface Props {
  scenes: StoryboardScene[];
  onChange: (scenes: StoryboardScene[]) => void;
  onSave: () => void;
  onApproveAll: () => void;
  onGenerateApproved: () => void;
  onRegenerateScene: (sceneId: string) => void;
  onUsePhotoPan: (sceneId: string) => void;
  onUsePhotoPanForAll: () => void;
  onSetSceneStatus: (sceneId: string, status: "approved" | "rejected") => void;
  generationProgress: { current: number; total: number } | null;
  busy: boolean;
}

const STATUS_COLORS: Record<StoryboardScene["status"], { bg: string; fg: string }> = {
  planned: { bg: "#f0f0f0", fg: "#555" },
  generating: { bg: "#fff8e1", fg: "#a67c00" },
  generated: { bg: "#e8f0fe", fg: "#1a56db" },
  approved: { bg: "#e6f6ea", fg: "#1a7a34" },
  rejected: { bg: "#fdeceb", fg: "#b3261e" },
};

/**
 * Storyboard editor (Phase 2: reorder/remove/edit before spending credits;
 * Phase 3: trigger per-scene generation, review clips, approve/reject/
 * regenerate individually — never forcing the whole reel to regenerate
 * because one scene is bad).
 */
export function StoryboardEditor({
  scenes,
  onChange,
  onSave,
  onApproveAll,
  onGenerateApproved,
  onRegenerateScene,
  onUsePhotoPan,
  onUsePhotoPanForAll,
  onSetSceneStatus,
  generationProgress,
  busy,
}: Props) {
  function updateScene(id: string, patch: Partial<StoryboardScene>) {
    onChange(scenes.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function removeScene(id: string) {
    onChange(
      scenes
        .filter((s) => s.id !== id)
        .map((s, index) => ({ ...s, order: index }))
    );
  }

  function moveScene(id: string, direction: -1 | 1) {
    const index = scenes.findIndex((s) => s.id === id);
    const targetIndex = index + direction;
    if (index === -1 || targetIndex < 0 || targetIndex >= scenes.length) return;

    const reordered = [...scenes];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved!);
    onChange(reordered.map((s, i) => ({ ...s, order: i })));
  }

  const hasApprovable = scenes.some((s) => s.status === "planned");
  const hasGeneratable = scenes.some((s) => s.status === "approved" || s.status === "rejected");

  return (
    <section style={{ marginTop: 24 }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Storyboard</h2>
      <p style={{ color: "#666", marginBottom: 16 }}>
        Edit before generating — no Higgsfield credits are spent until you generate scenes.
      </p>

      <div style={{ display: "grid", gap: 12 }}>
        {scenes.map((scene, index) => {
          const colors = STATUS_COLORS[scene.status];
          return (
            <div
              key={scene.id}
              style={{ display: "flex", gap: 12, padding: 12, border: "1px solid #ddd", borderRadius: 10, alignItems: "flex-start" }}
            >
              {scene.generatedVideoUrl ? (
                <video
                  src={scene.generatedVideoUrl}
                  controls
                  muted
                  style={{ width: 128, height: 96, objectFit: "cover", borderRadius: 8, flexShrink: 0, background: "#000" }}
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- local static preview
                <img
                  src={scene.imageId}
                  alt={scene.roomType}
                  style={{ width: 96, height: 96, objectFit: "cover", borderRadius: 8, flexShrink: 0 }}
                />
              )}

              <div style={{ flex: 1, display: "grid", gap: 6 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <strong style={{ textTransform: "capitalize" }}>{scene.roomType.replace("_", " ")}</strong>
                  <span style={{ fontSize: 12, color: "#888" }}>Scene {index + 1}</span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      padding: "2px 8px",
                      borderRadius: 999,
                      background: colors.bg,
                      color: colors.fg,
                    }}
                  >
                    {scene.status}
                  </span>
                </div>

                {scene.generationError && (
                  <p style={{ fontSize: 12, color: "#b3261e", margin: 0 }}>{scene.generationError}</p>
                )}

                <div style={{ display: "flex", gap: 8 }}>
                  <select
                    value={scene.cameraMotion}
                    onChange={(e) => updateScene(scene.id, { cameraMotion: e.target.value })}
                    style={{ padding: 6, borderRadius: 6, border: "1px solid #ccc" }}
                  >
                    {CAMERA_MOTIONS.map((m) => (
                      <option key={m} value={m}>
                        {m.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={scene.durationSeconds}
                    onChange={(e) => updateScene(scene.id, { durationSeconds: Number(e.target.value) })}
                    style={{ width: 70, padding: 6, borderRadius: 6, border: "1px solid #ccc" }}
                  />
                  <span style={{ alignSelf: "center", fontSize: 13, color: "#888" }}>seconds</span>
                </div>

                <textarea
                  value={scene.higgsfieldPrompt}
                  onChange={(e) => updateScene(scene.id, { higgsfieldPrompt: e.target.value })}
                  rows={2}
                  style={{ padding: 8, borderRadius: 6, border: "1px solid #ccc", fontSize: 12, fontFamily: "monospace" }}
                />

                {scene.generatedVideoUrl && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button type="button" onClick={() => onSetSceneStatus(scene.id, "approved")} disabled={busy} style={smallLabelBtn}>
                      Approve clip
                    </button>
                    <button type="button" onClick={() => onSetSceneStatus(scene.id, "rejected")} disabled={busy} style={smallLabelBtn}>
                      Reject
                    </button>
                    <button type="button" onClick={() => onRegenerateScene(scene.id)} disabled={busy} style={smallLabelBtn}>
                      Regenerate
                    </button>
                  </div>
                )}

                {(scene.status === "approved" || scene.status === "rejected") && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button type="button" onClick={() => onUsePhotoPan(scene.id)} disabled={busy} style={smallLabelBtn}>
                      Use Photo Pan Instead
                    </button>
                    <span style={{ fontSize: 11, color: "#888", alignSelf: "center" }}>
                      No AI video — pans/zooms over the still photo
                    </span>
                  </div>
                )}
              </div>

              <div style={{ display: "grid", gap: 4 }}>
                <button type="button" onClick={() => moveScene(scene.id, -1)} disabled={index === 0} style={smallBtn}>
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveScene(scene.id, 1)}
                  disabled={index === scenes.length - 1}
                  style={smallBtn}
                >
                  ↓
                </button>
                <button type="button" onClick={() => removeScene(scene.id)} style={{ ...smallBtn, color: "#b3261e" }}>
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 16, alignItems: "center" }}>
        <button type="button" onClick={onSave} disabled={busy} style={secondaryBtn}>
          Save Changes
        </button>
        {hasApprovable && (
          <button type="button" onClick={onApproveAll} disabled={busy} style={primaryBtn}>
            Approve Storyboard
          </button>
        )}
        {hasGeneratable && (
          <button type="button" onClick={onGenerateApproved} disabled={busy} style={primaryBtn}>
            Generate Cinematic Clips
          </button>
        )}
        {hasGeneratable && (
          <button type="button" onClick={onUsePhotoPanForAll} disabled={busy} style={secondaryBtn}>
            Use Photo Pan for All
          </button>
        )}
        {generationProgress && (
          <span style={{ fontSize: 14, color: "#666" }}>
            Generating scene {generationProgress.current} of {generationProgress.total}…
          </span>
        )}
      </div>
    </section>
  );
}

const smallBtn: React.CSSProperties = {
  width: 32,
  height: 28,
  border: "1px solid #ccc",
  borderRadius: 6,
  background: "#fff",
  cursor: "pointer",
};

const smallLabelBtn: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: 12,
  border: "1px solid #ccc",
  borderRadius: 6,
  background: "#fff",
  cursor: "pointer",
};

const primaryBtn: React.CSSProperties = {
  padding: "10px 16px",
  fontWeight: 600,
  borderRadius: 8,
  border: "none",
  background: "#111",
  color: "#fff",
  cursor: "pointer",
};

const secondaryBtn: React.CSSProperties = {
  padding: "10px 16px",
  fontWeight: 600,
  borderRadius: 8,
  border: "1px solid #111",
  background: "#fff",
  cursor: "pointer",
};
