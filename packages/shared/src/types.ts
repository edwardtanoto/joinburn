export const PROVIDERS = [
  "claude",
  "codex",
  "opencode",
  "amp",
  "droid",
  "codebuff",
  "hermes",
  "pi",
  "goose",
  "openclaw",
  "kilo",
  "kimi",
  "qwen",
  "copilot",
  "gemini",
] as const;

export type Provider = (typeof PROVIDERS)[number];

const PROVIDER_SET = new Set<string>(PROVIDERS);

export function isProvider(value: unknown): value is Provider {
  return typeof value === "string" && PROVIDER_SET.has(value);
}

export type DailyUsageRow = {
  date: string;
  provider: Provider;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
  messages: number;
  sessions: number;
};

export type ProviderSnapshot = {
  provider: Provider;
  firstSessionDate: string | null;
  favoriteModel: string | null;
  longestSessionMs: number;
  longestSessionTurns: number;
  totalSessions: number;
  totalMessages: number;
  topTools: { name: string; runs: number }[];
};

export type IngestPayload = {
  collectorVersion: string;
  rows: DailyUsageRow[];
  snapshots: ProviderSnapshot[];
};

export type PairResponse = { deviceToken: string; username: string };

export const MAX_INGEST_ROWS = 500;
