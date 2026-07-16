// Historical wire name: `provider`. These values identify the agent/source
// that produced the usage, not necessarily the model vendor. For example,
// OpenCode can run models from several vendors.
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

export const COLLECTOR_SCHEDULER_STATES = ["active", "missing", "manual", "unknown"] as const;
export type CollectorSchedulerState = (typeof COLLECTOR_SCHEDULER_STATES)[number];

export const COLLECTOR_PARSER_STATES = ["ready", "fallback", "install_failed", "unknown"] as const;
export type CollectorParserState = (typeof COLLECTOR_PARSER_STATES)[number];

export const COLLECTOR_ERROR_CODES = [
  "authentication",
  "network",
  "rate_limited",
  "service",
  "filesystem",
  "parser",
  "scheduler",
  "unknown",
] as const;
export type CollectorErrorCode = (typeof COLLECTOR_ERROR_CODES)[number];

export const COLLECTOR_REPORT_STATES = ["attempt", "failed"] as const;
export type CollectorReportState = (typeof COLLECTOR_REPORT_STATES)[number];

const COLLECTOR_ERROR_CODE_SET = new Set<string>(COLLECTOR_ERROR_CODES);

export function isCollectorErrorCode(value: unknown): value is CollectorErrorCode {
  return typeof value === "string" && COLLECTOR_ERROR_CODE_SET.has(value);
}

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

/**
 * Privacy-safe collector health metadata. Raw errors, paths, prompts, project
 * names, and session content are deliberately excluded from this contract.
 */
export type CollectorStatusReport = {
  state: CollectorReportState;
  collectorVersion: string;
  schedulerState: CollectorSchedulerState;
  parserState: CollectorParserState;
  detectedProviders: Provider[];
  errorCode?: CollectorErrorCode;
};

export type PairResponse = { deviceToken: string; username: string };

export const MAX_INGEST_ROWS = 500;
