import { createHash } from "node:crypto";
import { chmod, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { CONFIG_DIR, saveConfig, type CollectorConfig } from "./config";

const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;

type CollectorManifest = {
  version: string;
  sha256: string;
  path: string;
};

function managedEntry(): string | null {
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
  const expected = path.join(CONFIG_DIR, "cli.mjs");
  return entry === expected ? entry : null;
}

function versionParts(version: string): number[] | null {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return null;
  return version.split(".").map(Number);
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const a = versionParts(candidate);
  const b = versionParts(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]!;
  }
  return false;
}

function validManifest(value: unknown): value is CollectorManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<CollectorManifest>;
  return (
    typeof manifest.version === "string" &&
    typeof manifest.sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(manifest.sha256) &&
    typeof manifest.path === "string" &&
    manifest.path.startsWith("/")
  );
}

export async function maybeUpdateCollector(cfg: CollectorConfig, currentVersion: string): Promise<boolean> {
  const entry = managedEntry();
  if (!entry) return false;
  const checkedAt = cfg.lastUpdateCheckAt ? Date.parse(cfg.lastUpdateCheckAt) : 0;
  if (Number.isFinite(checkedAt) && Date.now() - checkedAt < UPDATE_INTERVAL_MS) return false;

  cfg.lastUpdateCheckAt = new Date().toISOString();
  saveConfig(cfg);
  const response = await fetch(`${cfg.apiBase}/collector-manifest.json`);
  if (!response.ok) throw new Error(`collector update check returned HTTP ${response.status}`);
  const manifest = await response.json().catch(() => null);
  if (!validManifest(manifest)) throw new Error("collector update manifest is invalid");
  if (!isNewerVersion(manifest.version, currentVersion)) return false;

  const download = await fetch(new URL(manifest.path, cfg.apiBase));
  if (!download.ok) throw new Error(`collector update download returned HTTP ${download.status}`);
  const bytes = new Uint8Array(await download.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== manifest.sha256) throw new Error("collector update checksum mismatch");

  const temporary = `${entry}.next`;
  try {
    await writeFile(temporary, bytes, { mode: 0o700 });
    await chmod(temporary, 0o700);
    await rename(temporary, entry);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return true;
}
