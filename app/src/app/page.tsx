"use client";

import { useState, type FormEvent } from "react";
import type { ImportedListing } from "@/lib/listing/types";
import type { ImageAnalysis } from "@/lib/vision/schema";
import type { StoryboardScene } from "@/lib/storyboard/types";
import { StoryboardEditor } from "./components/StoryboardEditor";

type ImportErrorResponse = {
  error: string;
  message: string;
  platform?: string;
  fallbackAvailable?: boolean;
};

type ImportSuccessResponse = {
  projectId: string;
  listing: ImportedListing;
};

type AnalyzeResponse = {
  projectId: string;
  imageAnalyses: ImageAnalysis[];
  failures: { imageId: string; message: string }[];
};

type StoryboardResponse = {
  projectId: string;
  storyboard: StoryboardScene[];
};

export default function Home() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showFallback, setShowFallback] = useState(false);
  const [project, setProject] = useState<ImportSuccessResponse | null>(null);
  const [analyses, setAnalyses] = useState<ImageAnalysis[] | null>(null);
  const [storyboard, setStoryboard] = useState<StoryboardScene[] | null>(null);

  async function handleImport(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setErrorMessage(null);
    setShowFallback(false);

    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await res.json()) as ImportSuccessResponse | ImportErrorResponse;

      if (!res.ok || "error" in data) {
        const err = data as ImportErrorResponse;
        setErrorMessage(err.message);
        setShowFallback(Boolean(err.fallbackAvailable));
        return;
      }

      setProject(data);
      setAnalyses(null);
      setStoryboard(null);
    } catch {
      setErrorMessage("Something went wrong contacting the server.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setErrorMessage(null);

    const formData = new FormData(event.currentTarget);

    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = (await res.json()) as ImportSuccessResponse | ImportErrorResponse;

      if (!res.ok || "error" in data) {
        setErrorMessage((data as ImportErrorResponse).message);
        return;
      }

      setProject(data);
      setShowFallback(false);
      setAnalyses(null);
      setStoryboard(null);
    } catch {
      setErrorMessage("Something went wrong uploading photos.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAnalyze() {
    if (!project) return;
    setBusy(true);
    setErrorMessage(null);

    try {
      const res = await fetch(`/api/projects/${project.projectId}/analyze`, { method: "POST" });
      const data = (await res.json()) as AnalyzeResponse | ImportErrorResponse;

      if (!res.ok || "error" in data) {
        setErrorMessage((data as ImportErrorResponse).message);
        return;
      }

      setAnalyses(data.imageAnalyses);
      setStoryboard(null);
    } catch {
      setErrorMessage("Something went wrong analyzing photos.");
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerateStoryboard() {
    if (!project) return;
    setBusy(true);
    setErrorMessage(null);

    try {
      const res = await fetch(`/api/projects/${project.projectId}/storyboard`, { method: "POST" });
      const data = (await res.json()) as StoryboardResponse | ImportErrorResponse;

      if (!res.ok || "error" in data) {
        setErrorMessage((data as ImportErrorResponse).message);
        return;
      }

      setStoryboard(data.storyboard);
    } catch {
      setErrorMessage("Something went wrong building the storyboard.");
    } finally {
      setBusy(false);
    }
  }

  async function saveStoryboard(scenes: StoryboardScene[]) {
    if (!project) return;
    setBusy(true);
    setErrorMessage(null);

    try {
      const res = await fetch(`/api/projects/${project.projectId}/storyboard`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyboard: scenes }),
      });
      const data = (await res.json()) as StoryboardResponse | ImportErrorResponse;

      if (!res.ok || "error" in data) {
        setErrorMessage((data as ImportErrorResponse).message);
        return;
      }

      setStoryboard(data.storyboard);
    } catch {
      setErrorMessage("Something went wrong saving the storyboard.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Cinematic Property Reel Generator</h1>
      <p style={{ color: "#666", marginBottom: 32 }}>
        Paste a property listing URL to get started, or upload photos directly.
      </p>

      <form onSubmit={handleImport} style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          type="url"
          required
          placeholder="Paste property listing URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          style={{ flex: 1, padding: "12px 14px", fontSize: 16, border: "1px solid #ccc", borderRadius: 8 }}
        />
        <button
          type="submit"
          disabled={busy}
          style={{
            padding: "12px 20px",
            fontSize: 16,
            fontWeight: 600,
            borderRadius: 8,
            border: "none",
            background: "#111",
            color: "#fff",
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          Import Property
        </button>
      </form>

      {errorMessage && (
        <div
          role="alert"
          style={{ padding: 16, background: "#fff4f2", border: "1px solid #f3c7bb", borderRadius: 8, marginBottom: 16 }}
        >
          {errorMessage}
        </div>
      )}

      {showFallback && (
        <section style={{ padding: 20, border: "1px solid #ddd", borderRadius: 12, marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>
            This listing can&apos;t be imported automatically
          </h2>
          <p style={{ color: "#666", marginBottom: 16 }}>Upload the property photos instead.</p>

          <form onSubmit={handleUpload} style={{ display: "grid", gap: 10 }}>
            <input type="file" name="photos" accept="image/jpeg,image/png,image/webp" multiple required />
            <input name="address" placeholder="Address (optional)" style={inputStyle} />
            <div style={{ display: "flex", gap: 8 }}>
              <input name="price" placeholder="Price (optional)" style={inputStyle} />
              <input name="bedrooms" type="number" placeholder="Bedrooms" style={inputStyle} />
              <input name="bathrooms" type="number" placeholder="Bathrooms" style={inputStyle} />
            </div>
            <input name="propertyType" placeholder="Property type (optional)" style={inputStyle} />
            <textarea name="description" placeholder="Description (optional)" rows={3} style={inputStyle} />
            <button
              type="submit"
              disabled={busy}
              style={{ padding: "10px 16px", fontWeight: 600, borderRadius: 8, border: "1px solid #111", background: "#fff", cursor: busy ? "not-allowed" : "pointer" }}
            >
              Upload Photos
            </button>
          </form>
        </section>
      )}

      {project && (
        <section>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Property Preview</h2>
          <p style={{ color: "#666", marginBottom: 16 }}>
            {[project.listing.address, project.listing.price ? `£/$${project.listing.price}` : null, project.listing.propertyType]
              .filter(Boolean)
              .join(" · ") || "Manual entry"}
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
            {project.listing.imageUrls.map((src) => (
              // eslint-disable-next-line @next/next/no-img-element -- local static preview, no remote-image optimization needed
              <img key={src} src={src} alt="Property" style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 8 }} />
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button type="button" onClick={handleAnalyze} disabled={busy} style={primaryBtn}>
              {analyses ? "Re-analyze Photos" : "Analyze Photos"}
            </button>
            {analyses && (
              <button type="button" onClick={handleGenerateStoryboard} disabled={busy} style={secondaryBtn}>
                Generate Storyboard
              </button>
            )}
          </div>

          {analyses && (
            <p style={{ color: "#666", marginTop: 8, fontSize: 14 }}>
              {analyses.length} photo{analyses.length === 1 ? "" : "s"} analyzed &middot;{" "}
              {analyses.filter((a) => a.useInReel).length} recommended for the reel
            </p>
          )}
        </section>
      )}

      {storyboard && (
        <StoryboardEditor
          scenes={storyboard}
          onChange={setStoryboard}
          onSave={() => saveStoryboard(storyboard)}
          onApproveAll={() => saveStoryboard(storyboard.map((s) => ({ ...s, status: "approved" })))}
          busy={busy}
        />
      )}
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: 14,
  border: "1px solid #ccc",
  borderRadius: 8,
  flex: 1,
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
