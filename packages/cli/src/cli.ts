#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import os from "node:os";
import process from "node:process";
import {
  BRAND,
  COLLECTOR_VERSION,
  MAX_INGEST_ROWS,
  type DailyUsageRow,
  type IngestPayload,
  type PairResponse,
  type Provider,
  type ProviderSnapshot,
} from "@burnrate/shared";
import { CONFIG_PATH, loadConfig, saveConfig, type CollectorConfig } from "./config";
import { installDaemon, rotateDaemonLogs, uninstallDaemon } from "./daemon";
import { postJson } from "./http";
import { acquireSyncLock } from "./lock";
import { CCUSAGE_VERSION, ensureCcusageInstalled, isCcusageTrusted, parseCcusage } from "./parsers/ccusage";
import { parseClaude } from "./parsers/claude";
import { parseCodex } from "./parsers/codex";
import { maybeUpdateCollector } from "./updater";
import { mergeUsageRows, normalizeProviderSnapshots } from "./usage";

const VERSION = COLLECTOR_VERSION;
const FULL_RESCAN_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const CCUSAGE_INSTALL_RETRY_MS = 24 * 60 * 60 * 1000;
const CLI_COMMAND = process.argv[1]?.includes(`.${BRAND.cliName}`)
  ? `node ~/.${BRAND.cliName}/cli.mjs`
  : "npx joinburn";

function apiBase(flags: Map<string, string>): string {
  return flags.get("api") ?? process.env.BURNRATE_API ?? BRAND.apiBase;
}

function parseArgs(argv: string[]): { cmd: string[]; flags: Map<string, string> } {
  const cmd: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags.set(key, next);
        i++;
      } else flags.set(key, "true");
    } else cmd.push(a);
  }
  return { cmd, flags };
}

type LegacyCollection = { rows: DailyUsageRow[]; snapshots: ProviderSnapshot[] };

async function collectLegacy(sinceDate?: string): Promise<LegacyCollection> {
  const rows: DailyUsageRow[] = [];
  const snapshots: ProviderSnapshot[] = [];
  const [claude, codex] = await Promise.all([
    parseClaude().catch((error) => {
      console.warn(`  (claude enrichment failed: ${(error as Error).message})`);
      return null;
    }),
    parseCodex(sinceDate).catch((error) => {
      console.warn(`  (codex enrichment failed: ${(error as Error).message})`);
      return null;
    }),
  ]);
  if (claude) {
    rows.push(...claude.rows);
    snapshots.push(claude.snapshot);
  }
  if (codex) {
    rows.push(...codex.rows);
    // A date-filtered Codex scan only knows recent history. Preserve the
    // lifetime snapshot until the scheduled weekly full rescan refreshes it.
    if (!sinceDate) snapshots.push(codex.snapshot);
  }
  return { rows, snapshots };
}

function enrichCounts(rows: DailyUsageRow[], legacyRows: DailyUsageRow[]): void {
  const counts = new Map<string, { messages: number; sessions: number }>();
  for (const row of legacyRows) {
    const key = `${row.date}|${row.provider}`;
    const value = counts.get(key) ?? { messages: 0, sessions: 0 };
    value.messages += row.messages;
    value.sessions += row.sessions;
    counts.set(key, value);
  }
  const enriched = new Set<string>();
  for (const row of rows) {
    const key = `${row.date}|${row.provider}`;
    if (enriched.has(key)) continue;
    const value = counts.get(key);
    if (!value) continue;
    row.messages = value.messages;
    row.sessions = value.sessions;
    enriched.add(key);
  }
}

function replaceSnapshot(snapshots: ProviderSnapshot[], replacement: ProviderSnapshot): void {
  const index = snapshots.findIndex((snapshot) => snapshot.provider === replacement.provider);
  if (index >= 0) snapshots[index] = replacement;
  else snapshots.push(replacement);
}

async function prepareCcusage(cfg: CollectorConfig): Promise<CollectorConfig> {
  if (cfg.ccusageVersion === CCUSAGE_VERSION && (await isCcusageTrusted())) return cfg;
  const attemptedAt = cfg.ccusageInstallAttemptAt ? Date.parse(cfg.ccusageInstallAttemptAt) : 0;
  if (Number.isFinite(attemptedAt) && Date.now() - attemptedAt < CCUSAGE_INSTALL_RETRY_MS) return cfg;
  const now = new Date().toISOString();
  try {
    await ensureCcusageInstalled();
    const next = { ...cfg, ccusageVersion: CCUSAGE_VERSION, ccusageInstallAttemptAt: now };
    saveConfig(next);
    console.log(`✓ multi-agent parser ${CCUSAGE_VERSION} ready`);
    return next;
  } catch (error) {
    const next = { ...cfg, ccusageInstallAttemptAt: now };
    saveConfig(next);
    console.warn(`  (ccusage install failed; retrying tomorrow: ${(error as Error).message})`);
    return next;
  }
}

function ensureInstallationId(cfg: CollectorConfig): CollectorConfig {
  if (cfg.installationId) return cfg;
  const next = { ...cfg, installationId: randomUUID() };
  saveConfig(next);
  return next;
}

type Collection = { rows: DailyUsageRow[]; snapshots: ProviderSnapshot[]; sources: Provider[] };

async function collectAll(sinceDate?: string): Promise<Collection> {
  const legacy = await collectLegacy(sinceDate);
  try {
    const ccusage = await parseCcusage(sinceDate);
    if (ccusage?.rows.length) {
      for (const warning of ccusage.warnings) console.warn(`  (${warning})`);
      enrichCounts(ccusage.rows, legacy.rows);
      const snapshots = sinceDate ? [] : [...ccusage.snapshots];
      for (const snapshot of legacy.snapshots) replaceSnapshot(snapshots, snapshot);
      const sources = [...new Set(ccusage.rows.map((row) => row.provider))] as Provider[];
      console.log(`  ccusage ${CCUSAGE_VERSION}: ${sources.join(", ")}`);
      return { rows: mergeUsageRows(ccusage.rows), snapshots, sources };
    }
  } catch (error) {
    console.warn(`  (ccusage failed, using built-in Claude/Codex fallback: ${(error as Error).message})`);
  }

  if (!legacy.rows.length) console.log("  (no supported local agent history found)");
  return {
    rows: mergeUsageRows(legacy.rows),
    snapshots: legacy.snapshots,
    sources: [...new Set(legacy.rows.map((row) => row.provider))],
  };
}

async function syncOnce(cfg: CollectorConfig, full: boolean): Promise<number> {
  const lastFullSync = cfg.lastFullSyncAt ? Date.parse(cfg.lastFullSyncAt) : 0;
  let effectiveFull = full || !Number.isFinite(lastFullSync) || Date.now() - lastFullSync >= FULL_RESCAN_INTERVAL_MS;
  let collection = await collectAll(effectiveFull ? undefined : cfg.lastSyncDate ?? undefined);
  const knownSources = new Set(cfg.detectedProviders ?? []);
  const discoveredSource = !effectiveFull && collection.sources.some((source) => !knownSources.has(source));
  if (discoveredSource) {
    console.log("  new agent source detected — backfilling its full history");
    effectiveFull = true;
    collection = await collectAll();
  }
  // Incremental: resend the last synced day too (it may have grown), plus
  // anything newer. Upserts are idempotent so overlap is safe.
  const since = !effectiveFull && cfg.lastSyncDate ? cfg.lastSyncDate : "0000-00-00";
  const { rows } = collection;
  const snapshots = normalizeProviderSnapshots(collection.snapshots);
  const pending = rows.filter((r) => r.date >= since).sort((a, b) => a.date.localeCompare(b.date));

  if (pending.length === 0) {
    await postJson(
      cfg.apiBase,
      "/v1/ingest",
      { collectorVersion: VERSION, rows: [], snapshots } satisfies IngestPayload,
      cfg.deviceToken,
      { attempts: 4 },
    );
  }

  for (let i = 0; i < pending.length; i += MAX_INGEST_ROWS) {
    const chunk = pending.slice(i, i + MAX_INGEST_ROWS);
    const payload: IngestPayload = {
      collectorVersion: VERSION,
      rows: chunk,
      // Snapshots only need to ride along once, on the final chunk.
      snapshots: i + MAX_INGEST_ROWS >= pending.length ? snapshots : [],
    };
    await postJson(cfg.apiBase, "/v1/ingest", payload, cfg.deviceToken, { attempts: 4 });
  }

  const newest = pending[pending.length - 1]?.date ?? cfg.lastSyncDate;
  saveConfig({
    ...cfg,
    lastSyncDate: newest ?? null,
    lastSyncAt: new Date().toISOString(),
    lastFullSyncAt: effectiveFull ? new Date().toISOString() : cfg.lastFullSyncAt ?? null,
    lastError: null,
    lastErrorAt: null,
    consecutiveFailures: 0,
    detectedProviders: [...new Set([...(cfg.detectedProviders ?? []), ...collection.sources])],
  });
  return pending.length;
}

async function cmdConnect(flags: Map<string, string>) {
  const code = flags.get("code");
  if (!code) {
    console.error(`usage: ${CLI_COMMAND} connect --code XXX-NNN`);
    process.exit(1);
  }
  const base = apiBase(flags);
  const installationId = loadConfig()?.installationId ?? randomUUID();
  console.log(`→ preparing multi-agent parser (ccusage ${CCUSAGE_VERSION}) …`);
  let ccusageReady = false;
  try {
    const state = await ensureCcusageInstalled();
    ccusageReady = true;
    console.log(state === "installed" ? "✓ multi-agent parser installed" : "✓ multi-agent parser ready");
  } catch (error) {
    console.warn(`! ccusage install failed; Claude/Codex fallback remains available: ${(error as Error).message}`);
  }
  console.log(`→ pairing with ${base} …`);
  const pair = await postJson<PairResponse>(
    base,
    "/v1/pair",
    {
      code,
      deviceName: os.hostname(),
      platform: os.platform(),
      collectorVersion: VERSION,
      installationId,
    },
    undefined,
    { attempts: 4 },
  );
  const cfg: CollectorConfig = {
    apiBase: base,
    deviceToken: pair.deviceToken,
    username: pair.username,
    installationId,
    lastSyncDate: null,
    lastSyncAt: null,
    lastFullSyncAt: null,
    lastError: null,
    lastErrorAt: null,
    consecutiveFailures: 0,
    ccusageVersion: ccusageReady ? CCUSAGE_VERSION : null,
    ccusageInstallAttemptAt: new Date().toISOString(),
    detectedProviders: [],
  };
  saveConfig(cfg);
  console.log(`✓ paired as @${pair.username} (device: ${os.hostname()})`);

  console.log("→ first sync …");
  const n = await syncOnce(cfg, true);
  console.log(`✓ first sync: ${n} day-rows uploaded`);

  if (flags.get("no-daemon") !== "true") {
    console.log(`✓ ${installDaemon()}`);
  }
  console.log(`\nDone. Profile is live — open the ${BRAND.displayName} app.`);
}

async function cmdSync(flags: Map<string, string>) {
  const loaded = loadConfig();
  if (!loaded) {
    console.error(`Not connected. Run: ${CLI_COMMAND} connect --code XXX-NNN`);
    process.exit(1);
  }
  const releaseLock = acquireSyncLock();
  if (!releaseLock) {
    console.log("sync already running; this attempt will exit safely");
    return;
  }
  try {
    const cfg = await prepareCcusage(ensureInstallationId(loaded));
    const updated = await maybeUpdateCollector(cfg, VERSION).catch((error) => {
      console.warn(`  (collector update check failed: ${(error as Error).message})`);
      return false;
    });
    if (updated) console.log("✓ collector updated; the new version will run on the next sync");
    const n = await syncOnce(cfg, flags.get("full") === "true");
    console.log(`✓ synced ${n} day-rows for @${cfg.username}`);
  } catch (e) {
    // Daemon-friendly: log and exit non-zero; next scheduled run retries.
    const message = (e as Error).message;
    const current = loadConfig() ?? loaded;
    saveConfig({
      ...current,
      lastError: message,
      lastErrorAt: new Date().toISOString(),
      consecutiveFailures: (current.consecutiveFailures ?? 0) + 1,
    });
    console.error(`sync failed: ${message}`);
    process.exitCode = 1;
  } finally {
    releaseLock();
  }
}

function cmdStatus() {
  const cfg = loadConfig();
  if (!cfg) {
    console.log(`not connected (no ${CONFIG_PATH})`);
    return;
  }
  console.log(`user:       @${cfg.username}`);
  console.log(`api:        ${cfg.apiBase}`);
  console.log(`last sync:  ${cfg.lastSyncAt ?? cfg.lastSyncDate ?? "never"}`);
  if (cfg.lastError) console.log(`last error: ${cfg.lastErrorAt ?? "unknown time"} — ${cfg.lastError}`);
  if (cfg.consecutiveFailures) console.log(`failures:   ${cfg.consecutiveFailures} consecutive attempt(s)`);
}

async function main() {
  rotateDaemonLogs();
  const { cmd, flags } = parseArgs(process.argv.slice(2));
  const [c0, c1] = cmd;
  try {
    if (c0 === "connect") await cmdConnect(flags);
    else if (c0 === "sync") await cmdSync(flags);
    else if (c0 === "status") cmdStatus();
    else if (c0 === "daemon" && c1 === "install") console.log(installDaemon());
    else if (c0 === "daemon" && c1 === "uninstall") console.log(uninstallDaemon());
    else {
      console.log(`${BRAND.displayName} collector v${VERSION} — aggregates only, never content`);
      console.log(`
usage:
  ${CLI_COMMAND} connect --code XXX-NNN   pair this machine + first sync + daemon
  ${CLI_COMMAND} sync [--full]            sync now (daemon runs this)
  ${CLI_COMMAND} status                   show link state
  ${CLI_COMMAND} daemon install           (re)install the 30-min sync daemon
  ${CLI_COMMAND} daemon uninstall         remove the daemon

flags: --api <base-url> (or BURNRATE_API env) to target a different server`);
    }
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    process.exit(1);
  }
}

main();
