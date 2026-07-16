import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CCUSAGE_CLI_SHA256,
  CCUSAGE_NATIVE_SHA256,
  CCUSAGE_PACKAGE_INTEGRITY,
  CCUSAGE_PACKAGE_LOCK,
  CCUSAGE_VERSION,
  isCcusageTrusted,
  parseCcusageJson,
} from "./ccusage";

const REPORT = JSON.stringify({
  daily: [
    {
      agent: "all",
      period: "2026-07-12",
      agents: [
        {
          agent: "opencode",
          modelBreakdowns: [
            {
              modelName: "claude-sonnet-4-6",
              inputTokens: 10,
              outputTokens: 20,
              cacheReadTokens: 30,
              cacheCreationTokens: 40,
              cost: 0.5,
            },
          ],
        },
        { agent: "future-agent", modelBreakdowns: [] },
      ],
    },
  ],
});

describe("parseCcusageJson", () => {
  test("normalizes supported agents and model token buckets", () => {
    const result = parseCcusageJson(REPORT);
    expect(result.rows).toEqual([
      {
        date: "2026-07-12",
        provider: "opencode",
        model: "claude-sonnet-4-6",
        input: 10,
        output: 20,
        cacheRead: 30,
        cacheWrite: 40,
        costUsd: 0.5,
        messages: 0,
        sessions: 0,
      },
    ]);
    expect(result.snapshots[0]?.favoriteModel).toBe("claude-sonnet-4-6");
    expect(result.warnings).toEqual(["unsupported ccusage source: future-agent"]);
  });

  test("rejects non-JSON and does not leak arbitrary fields", () => {
    expect(() => parseCcusageJson("not-json")).toThrow("invalid JSON");
    const result = parseCcusageJson(REPORT.replace('"cost":0.5', '"cost":0.5,"prompt":"private"'));
    expect(JSON.stringify(result)).not.toContain("private");
  });
});

describe("ccusage runtime integrity", () => {
  test("locks the wrapper and every supported native package", () => {
    const packages = CCUSAGE_PACKAGE_LOCK.packages as Record<
      string,
      { integrity?: string; version?: string }
    >;
    expect(packages["node_modules/ccusage"]?.version).toBe(CCUSAGE_VERSION);
    expect(packages["node_modules/ccusage"]?.integrity).toBe(CCUSAGE_PACKAGE_INTEGRITY);
    expect(CCUSAGE_CLI_SHA256).toMatch(/^[a-f0-9]{64}$/);

    for (const [target, binaryHash] of Object.entries(CCUSAGE_NATIVE_SHA256)) {
      const entry = packages[`node_modules/@ccusage/ccusage-${target}`];
      expect(entry?.version).toBe(CCUSAGE_VERSION);
      expect(entry?.integrity).toMatch(/^sha512-/);
      expect(binaryHash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  test("rejects unsupported targets and modified installations", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "burn-ccusage-integrity-"));
    try {
      const packageRoot = path.join(root, "node_modules", "ccusage");
      const nativeRoot = path.join(
        root,
        "node_modules",
        "@ccusage",
        "ccusage-darwin-arm64",
        "bin",
      );
      await Promise.all([
        mkdir(path.join(packageRoot, "src"), { recursive: true }),
        mkdir(nativeRoot, { recursive: true }),
      ]);
      await Promise.all([
        writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ version: CCUSAGE_VERSION })),
        writeFile(path.join(packageRoot, "src", "cli.js"), "modified"),
        writeFile(path.join(nativeRoot, "ccusage"), "modified"),
      ]);

      expect(await isCcusageTrusted(root, "darwin", "arm64")).toBe(false);
      expect(await isCcusageTrusted(root, "freebsd", "x64")).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
