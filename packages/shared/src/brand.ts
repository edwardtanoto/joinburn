// Single source of truth for branding. Rename the product here and only here.
export const BRAND = {
  name: "burn",
  displayName: "BURN",
  cliName: "burnstats",
  tagline: "my agents never sleep",
  domain: "joinburn.app",
  apiBase: "https://api.joinburn.app",
  scheme: "burnrate",
  accent: "#FF4433",
} as const;

export const PRODUCTION_AGENT_GUIDE_URL = `https://${BRAND.domain}/agents.md`;

export const COLLECTOR_VERSION = "0.2.3";
export const TERMS_VERSION = "2026-07-15";
