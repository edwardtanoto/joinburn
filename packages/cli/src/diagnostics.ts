import {
  COLLECTOR_VERSION,
  isCollectorErrorCode,
  isProvider,
  type CollectorErrorCode,
  type CollectorParserState,
  type CollectorSchedulerState,
  type CollectorStatusReport,
  type Provider,
} from "@joinburn/shared";
import type { CollectorConfig } from "./config";
import { inspectDaemonState } from "./daemon";
import { CollectorHttpError, type FetchLike } from "./http";
import { isCcusageTrusted } from "./parsers/ccusage";

type ErrorWithCode = Error & { code?: unknown; cause?: unknown };

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? ` ${error.cause.message}` : "";
    return `${error.name} ${error.message}${cause}`.toLowerCase();
  }
  return String(error).toLowerCase();
}

export function classifyCollectorError(error: unknown): CollectorErrorCode {
  if (error instanceof CollectorHttpError) {
    if (error.status === 401 || error.status === 403) return "authentication";
    if (error.status === 429) return "rate_limited";
    if (error.status >= 500) return "service";
  }

  const text = errorText(error);
  if (/launchctl|systemctl|schtasks|scheduled task|daemon/.test(text)) return "scheduler";
  if (/ccusage|parser|integrity|checksum|unsupported source/.test(text)) return "parser";

  const code = error instanceof Error ? (error as ErrorWithCode).code : undefined;
  if (["EACCES", "EPERM", "EROFS", "ENOSPC", "ENOTDIR"].includes(String(code))) return "filesystem";
  if (/aborterror|fetch failed|network|timed? out|econn|enotfound|eai_again|socket/.test(text)) return "network";
  return "unknown";
}

export async function inspectParserState(config: CollectorConfig): Promise<CollectorParserState> {
  if (await isCcusageTrusted()) return "ready";
  if (config.parserState === "fallback") return "fallback";
  return config.ccusageInstallAttemptAt ? "install_failed" : "unknown";
}

export async function localCollectorState(config: CollectorConfig): Promise<{
  schedulerState: CollectorSchedulerState;
  parserState: CollectorParserState;
  detectedProviders: Provider[];
}> {
  return {
    schedulerState: config.schedulerMode === "manual" ? "manual" : inspectDaemonState(),
    parserState: await inspectParserState(config),
    detectedProviders: [...new Set((config.detectedProviders ?? []).filter(isProvider))],
  };
}

export async function collectorStatusReport(
  config: CollectorConfig,
  state: "attempt" | "failed",
  error?: unknown,
  overrides: Partial<Awaited<ReturnType<typeof localCollectorState>>> = {},
): Promise<CollectorStatusReport> {
  const local = { ...(await localCollectorState(config)), ...overrides };
  return {
    state,
    collectorVersion: COLLECTOR_VERSION,
    schedulerState: local.schedulerState,
    parserState: local.parserState,
    detectedProviders: local.detectedProviders,
    ...(state === "failed" ? { errorCode: classifyCollectorError(error) } : {}),
  };
}

export type CollectorDoctorResult = {
  connected: boolean;
  apiState: "reachable" | "authentication" | "network" | "service" | "unconfigured";
  username: string | null;
  apiBase: string | null;
  collectorVersion: string;
  lastSyncAt: string | null;
  lastErrorCode: CollectorErrorCode | null;
  schedulerState: CollectorSchedulerState;
  parserState: CollectorParserState;
  detectedProviders: Provider[];
  recommendedAction: "none" | "repair" | "connect" | "reconnect";
  command: string | null;
};

export async function inspectCollectorApi(
  config: CollectorConfig,
  fetcher: FetchLike = fetch,
): Promise<CollectorDoctorResult["apiState"]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetcher(`${config.apiBase}/v1/collector/ping`, {
      headers: { authorization: `Bearer ${config.deviceToken}` },
      signal: controller.signal,
    });
    if (response.ok) return "reachable";
    if (response.status === 401 || response.status === 403) return "authentication";
    return "service";
  } catch {
    return "network";
  } finally {
    clearTimeout(timeout);
  }
}

export async function collectorDoctorResult(config: CollectorConfig | null): Promise<CollectorDoctorResult> {
  if (!config) {
    return {
      connected: false,
      apiState: "unconfigured",
      username: null,
      apiBase: null,
      collectorVersion: COLLECTOR_VERSION,
      lastSyncAt: null,
      lastErrorCode: null,
      schedulerState: "unknown",
      parserState: "unknown",
      detectedProviders: [],
      recommendedAction: "connect",
      command: "npx --yes joinburn@latest connect --code <PAIRING_CODE>",
    };
  }
  const [local, apiState] = await Promise.all([localCollectorState(config), inspectCollectorApi(config)]);
  const storedErrorCode = isCollectorErrorCode(config.lastErrorCode)
    ? config.lastErrorCode
    : config.lastError
      ? classifyCollectorError(new Error(config.lastError))
      : null;
  const lastErrorCode = storedErrorCode
    ?? (apiState === "authentication" || apiState === "network" || apiState === "service" ? apiState : null);
  const recommendedAction = lastErrorCode === "authentication"
    ? "reconnect"
    : lastErrorCode || local.schedulerState === "missing" || local.parserState === "fallback" || local.parserState === "install_failed"
      ? "repair"
      : "none";
  return {
    connected: true,
    apiState,
    username: config.username,
    apiBase: config.apiBase,
    collectorVersion: COLLECTOR_VERSION,
    lastSyncAt: config.lastSyncAt ?? config.lastSyncDate ?? null,
    lastErrorCode,
    ...local,
    recommendedAction,
    command: recommendedAction === "none"
      ? null
      : recommendedAction === "reconnect"
        ? "npx --yes joinburn@latest connect --code <FRESH_PAIRING_CODE>"
        : "npx --yes joinburn@latest repair",
  };
}
