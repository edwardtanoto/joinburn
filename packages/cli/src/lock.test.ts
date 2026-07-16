import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireFileLock } from "./lock";

describe("acquireFileLock", () => {
  test("prevents overlap and only releases its own lock", () => {
    const directory = path.join(os.tmpdir(), `burn-lock-${crypto.randomUUID()}`);
    const file = path.join(directory, "sync.lock");
    mkdirSync(directory, { recursive: true });
    try {
      const release = acquireFileLock(file, 60_000);
      expect(release).toBeFunction();
      expect(acquireFileLock(file, 60_000)).toBeNull();
      writeFileSync(file, JSON.stringify({ token: "replacement" }));
      release?.();
      expect(acquireFileLock(file, 60_000)).toBeNull();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
