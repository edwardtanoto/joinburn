import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import {
  isProvider,
  type DailyUsageRow,
  type Provider,
  type ProviderSnapshot,
} from "@joinburn/shared";
import { CONFIG_DIR } from "../config";
import { normalizeUsageDate } from "../usage";
import ccusagePackageLock from "./ccusage-package-lock.json";

export const CCUSAGE_VERSION = "20.0.17";
export const CCUSAGE_PACKAGE_INTEGRITY =
  "sha512-MJU4qDs6DOMdam0PXWWFgo0dw/kXAK05rX586DdxIARTzj/zJylWfVlIywgJwW094nNbqwJyGRZvzO2ZsczXDg==";
export const CCUSAGE_CLI_SHA256 = "dc6a76a6bd41afae3005b63234034549875637e8e52a7664de4ee05ce8b0e5dc";
export const CCUSAGE_NATIVE_SHA256: Readonly<Record<string, string>> = {
  "darwin-arm64": "08c455a4307345ca2b0fcda3a81edd9421a7edd53ea0acea19309925a7af54c0",
  "darwin-x64": "ae4743f818ffccd34ca6ea399809a8e98613d4c709cff0d0aa0a5ecede4396f4",
  "linux-arm64": "4e51c44486fc1d2a19427b9fccccb8c013622a47ddbf4db1a066882aa449cfad",
  "linux-x64": "466935565e04255a7d25d1720b5944a43fb5dbd28874fe3be0e0ad3a89e61687",
  "win32-arm64": "54a8a62bfb948d37aecd7b416e678ae4e157d87c1718fbe3ca76e31d8316957b",
  "win32-x64": "a22156d2b08cd0802d2b7ac856c7140896c3df335871ce47dadd96b68dc44389",
};
const VENDOR_DIR = path.join(CONFIG_DIR, "vendor");
const CCUSAGE_PACKAGE = path.join(VENDOR_DIR, "node_modules", "ccusage");
const CCUSAGE_CLI = path.join(CCUSAGE_PACKAGE, "src", "cli.js");
const VENDOR_PACKAGE_JSON = path.join(VENDOR_DIR, "package.json");
const VENDOR_PACKAGE_LOCK = path.join(VENDOR_DIR, "package-lock.json");
const execFileAsync = promisify(execFile);

export const CCUSAGE_PACKAGE_LOCK = ccusagePackageLock;

type CcusageModel = {
  modelName?: unknown;
  inputTokens?: unknown;
  outputTokens?: unknown;
  cacheReadTokens?: unknown;
  cacheCreationTokens?: unknown;
  cost?: unknown;
};

type CcusageAgent = {
  agent?: unknown;
  modelBreakdowns?: unknown;
};

type CcusageDay = {
  period?: unknown;
  agents?: unknown;
};

function finiteNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && normalizeUsageDate(value) === value;
}

export function parseCcusageJson(raw: string): {
  rows: DailyUsageRow[];
  snapshots: ProviderSnapshot[];
  warnings: string[];
} {
  const warnings: string[] = [];
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error("ccusage returned invalid JSON");
  }

  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { daily?: unknown }).daily)) {
    throw new Error("ccusage JSON is missing the daily report");
  }

  const rows: DailyUsageRow[] = [];
  const firstDate = new Map<Provider, string>();
  const modelTotals = new Map<Provider, Map<string, number>>();

  for (const day of (payload as { daily: CcusageDay[] }).daily) {
    if (!isDate(day.period) || !Array.isArray(day.agents)) continue;
    for (const agent of day.agents as CcusageAgent[]) {
      if (!isProvider(agent.agent)) {
        if (typeof agent.agent === "string") warnings.push(`unsupported ccusage source: ${agent.agent}`);
        continue;
      }
      const provider = agent.agent;
      if (!firstDate.has(provider) || day.period < firstDate.get(provider)!) firstDate.set(provider, day.period);
      if (!Array.isArray(agent.modelBreakdowns)) continue;

      for (const breakdown of agent.modelBreakdowns as CcusageModel[]) {
        if (typeof breakdown.modelName !== "string" || !breakdown.modelName) continue;
        const input = finiteNonNegative(breakdown.inputTokens);
        const output = finiteNonNegative(breakdown.outputTokens);
        const cacheRead = finiteNonNegative(breakdown.cacheReadTokens);
        const cacheWrite = finiteNonNegative(breakdown.cacheCreationTokens);
        rows.push({
          date: day.period,
          provider,
          model: breakdown.modelName,
          input,
          output,
          cacheRead,
          cacheWrite,
          costUsd: finiteNonNegative(breakdown.cost),
          messages: 0,
          sessions: 0,
        });
        const totals = modelTotals.get(provider) ?? new Map<string, number>();
        totals.set(breakdown.modelName, (totals.get(breakdown.modelName) ?? 0) + input + output + cacheRead + cacheWrite);
        modelTotals.set(provider, totals);
      }
    }
  }

  const snapshots: ProviderSnapshot[] = [...modelTotals].map(([provider, totals]) => ({
    provider,
    firstSessionDate: firstDate.get(provider) ?? null,
    favoriteModel: [...totals].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    longestSessionMs: 0,
    longestSessionTurns: 0,
    totalSessions: 0,
    totalMessages: 0,
    topTools: [],
  }));

  rows.sort((a, b) => a.date.localeCompare(b.date) || a.provider.localeCompare(b.provider));
  return { rows, snapshots, warnings: [...new Set(warnings)] };
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function installedVersion(root = VENDOR_DIR): Promise<string | null> {
  try {
    const pkg = JSON.parse(
      await readFile(path.join(root, "node_modules", "ccusage", "package.json"), "utf8"),
    ) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

function nativeBinaryPath(root = VENDOR_DIR, platform = process.platform, arch = process.arch): string | null {
  const target = `${platform}-${arch}`;
  if (!CCUSAGE_NATIVE_SHA256[target]) return null;
  return path.join(
    root,
    "node_modules",
    "@ccusage",
    `ccusage-${target}`,
    "bin",
    platform === "win32" ? "ccusage.exe" : "ccusage",
  );
}

async function sha256File(file: string): Promise<string | null> {
  try {
    return createHash("sha256").update(await readFile(file)).digest("hex");
  } catch {
    return null;
  }
}

export async function isCcusageTrusted(
  root = VENDOR_DIR,
  platform = process.platform,
  arch = process.arch,
): Promise<boolean> {
  const target = `${platform}-${arch}`;
  const expectedNativeHash = CCUSAGE_NATIVE_SHA256[target];
  const native = nativeBinaryPath(root, platform, arch);
  if (!expectedNativeHash || !native || (await installedVersion(root)) !== CCUSAGE_VERSION) return false;
  const cli = path.join(root, "node_modules", "ccusage", "src", "cli.js");
  const [cliHash, nativeHash] = await Promise.all([sha256File(cli), sha256File(native)]);
  return cliHash === CCUSAGE_CLI_SHA256 && nativeHash === expectedNativeHash;
}

async function writeVendorManifests(): Promise<void> {
  const packageJson = {
    name: "burnstats-ccusage-runtime",
    version: "1.0.0",
    private: true,
    dependencies: { ccusage: CCUSAGE_VERSION },
  };
  await Promise.all([
    writeFile(VENDOR_PACKAGE_JSON, `${JSON.stringify(packageJson, null, 2)}\n`, { mode: 0o600 }),
    writeFile(VENDOR_PACKAGE_LOCK, `${JSON.stringify(CCUSAGE_PACKAGE_LOCK, null, 2)}\n`, { mode: 0o600 }),
  ]);
  await Promise.all([chmod(VENDOR_PACKAGE_JSON, 0o600), chmod(VENDOR_PACKAGE_LOCK, 0o600)]);
}

function npmExecutable(): string {
  const sibling = path.join(path.dirname(process.execPath), process.platform === "win32" ? "npm.cmd" : "npm");
  return sibling;
}

export async function ensureCcusageInstalled(): Promise<"installed" | "ready"> {
  if (await isCcusageTrusted()) return "ready";
  if (!nativeBinaryPath()) {
    throw new Error(`ccusage ${CCUSAGE_VERSION} does not support ${process.platform}-${process.arch}`);
  }
  await mkdir(VENDOR_DIR, { recursive: true, mode: 0o700 });
  await chmod(VENDOR_DIR, 0o700);
  await writeVendorManifests();
  const npm = (await exists(npmExecutable())) ? npmExecutable() : process.platform === "win32" ? "npm.cmd" : "npm";
  await execFileAsync(
    npm,
    [
      "ci",
      "--prefix",
      VENDOR_DIR,
      "--no-audit",
      "--no-fund",
      "--ignore-scripts",
    ],
    { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
  );
  if (!(await isCcusageTrusted())) {
    throw new Error("ccusage installation failed Burn's pinned integrity verification");
  }
  return "installed";
}

export async function parseCcusage(sinceDate?: string): Promise<{
  rows: DailyUsageRow[];
  snapshots: ProviderSnapshot[];
  warnings: string[];
} | null> {
  if (!(await isCcusageTrusted())) return null;
  const args = [CCUSAGE_CLI, "daily", "--all", "--by-agent", "--json", "--offline"];
  if (sinceDate) args.push("--since", sinceDate);
  const { stdout } = await execFileAsync(process.execPath, args, {
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return parseCcusageJson(stdout);
}
