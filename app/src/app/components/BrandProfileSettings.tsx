"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { BrandProfile } from "@/lib/brand/types";

/**
 * Editable global brand profile (spec: one profile is enough, not
 * white-label multi-tenant). Loads the current profile on mount, saves via
 * PUT (multipart so a logo file can be attached in the same request).
 */
export function BrandProfileSettings() {
  const [profile, setProfile] = useState<BrandProfile>({});
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/brand-profile")
      .then((res) => res.json())
      .then((data: { profile: BrandProfile }) => setProfile(data.profile))
      .catch(() => undefined);
  }, []);

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setSaved(false);

    const formData = new FormData();
    for (const [key, value] of Object.entries(profile)) {
      if (typeof value === "string" && value) formData.set(key, value);
    }
    if (logoFile) formData.set("logo", logoFile);

    try {
      const res = await fetch("/api/brand-profile", { method: "PUT", body: formData });
      const data = (await res.json()) as { profile: BrandProfile };
      if (res.ok) {
        setProfile(data.profile);
        setSaved(true);
      }
    } finally {
      setBusy(false);
    }
  }

  function field(key: keyof BrandProfile): string {
    return profile[key] ?? "";
  }

  return (
    <details style={{ marginTop: 32, border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>Brand Settings</summary>
      <form onSubmit={handleSave} style={{ display: "grid", gap: 10, marginTop: 12 }}>
        <input
          placeholder="Company name"
          value={field("companyName")}
          onChange={(e) => setProfile({ ...profile, companyName: e.target.value })}
          style={inputStyle}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <input
            placeholder="Agent name"
            value={field("agentName")}
            onChange={(e) => setProfile({ ...profile, agentName: e.target.value })}
            style={inputStyle}
          />
          <input
            placeholder="Phone"
            value={field("phone")}
            onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
            style={inputStyle}
          />
        </div>
        <input
          placeholder="Website"
          value={field("website")}
          onChange={(e) => setProfile({ ...profile, website: e.target.value })}
          style={inputStyle}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ fontSize: 13, color: "#666" }}>
            Primary
            <input
              type="color"
              value={profile.primaryColor ?? "#111111"}
              onChange={(e) => setProfile({ ...profile, primaryColor: e.target.value })}
              style={{ marginLeft: 6 }}
            />
          </label>
          <label style={{ fontSize: 13, color: "#666" }}>
            Secondary
            <input
              type="color"
              value={profile.secondaryColor ?? "#ffffff"}
              onChange={(e) => setProfile({ ...profile, secondaryColor: e.target.value })}
              style={{ marginLeft: 6 }}
            />
          </label>
        </div>
        <input
          placeholder="CTA text (e.g. Book a viewing)"
          value={field("cta")}
          onChange={(e) => setProfile({ ...profile, cta: e.target.value })}
          style={inputStyle}
        />
        <div>
          <label style={{ fontSize: 13, color: "#666", display: "block", marginBottom: 4 }}>Logo</label>
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)} />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button type="submit" disabled={busy} style={primaryBtn}>
            Save Brand Profile
          </button>
          {saved && <span style={{ color: "#1a7a34", fontSize: 13 }}>Saved.</span>}
        </div>
      </form>
    </details>
  );
}

const inputStyle: React.CSSProperties = { padding: "10px 12px", fontSize: 14, border: "1px solid #ccc", borderRadius: 8, flex: 1 };
const primaryBtn: React.CSSProperties = {
  padding: "10px 16px",
  fontWeight: 600,
  borderRadius: 8,
  border: "none",
  background: "#111",
  color: "#fff",
  cursor: "pointer",
};
