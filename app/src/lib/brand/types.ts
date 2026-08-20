/**
 * One editable branding profile (spec: "Do not overbuild white-label SaaS
 * functionality. One editable branding profile is enough initially.") —
 * global, not per-project, per spec's exact field list.
 */
export type BrandProfile = {
  companyName?: string;
  logoPath?: string;
  agentName?: string;
  phone?: string;
  website?: string;
  primaryColor?: string;
  secondaryColor?: string;
  cta?: string;
};

export const DEFAULT_BRAND_PROFILE: BrandProfile = {
  primaryColor: "#111111",
  secondaryColor: "#ffffff",
  cta: "Book a viewing",
};
