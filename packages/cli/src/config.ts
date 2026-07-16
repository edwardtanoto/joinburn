import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BRAND, type Provider } from "@burnrate/shared";

export type CollectorConfig = {
  apiBase: string;
  deviceToken: string;
  username: string;
  installationId?: string;
  lastSyncDate: string | null; // YYYY-MM-DD of newest fully-synced day
  lastSyncAt?: string | null;
  lastFullSyncAt?: string | null;
  lastError?: string | null;
  lastErrorAt?: string | null;
  consecutiveFailures?: number;
  ccusageVersion?: string | null;
  ccusageInstallAttemptAt?: string | null;
  detectedProviders?: Provider[];
  lastUpdateCheckAt?: string | null;
};

export const CONFIG_DIR = path.join(os.homedir(), `.${BRAND.cliName}`);
export const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
export const SYNC_LOCK_PATH = path.join(CONFIG_DIR, "sync.lock");

function isCollectorConfig(value: unknown): value is CollectorConfig {
  if (!value || typeof value !== "object") return false;
  const config = value as Partial<CollectorConfig>;
  return (
    typeof config.apiBase === "string" &&
    /^https?:\/\//.test(config.apiBase) &&
    typeof config.deviceToken === "string" &&
    config.deviceToken.length >= 32 &&
    typeof config.username === "string" &&
    (config.lastSyncDate === null || typeof config.lastSyncDate === "string")
  );
}

export function loadConfig(): CollectorConfig | null {
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as unknown;
    return isCollectorConfig(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveConfig(cfg: CollectorConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  chmodSync(CONFIG_DIR, 0o700);
  const temporary = `${CONFIG_PATH}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    renameSync(temporary, CONFIG_PATH);
    chmodSync(CONFIG_PATH, 0o600);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {}
    throw error;
  }
}
