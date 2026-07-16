import { closeSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { SYNC_LOCK_PATH } from "./config";

export type LockRelease = () => void;

export function acquireFileLock(file: string, staleAfterMs: number, now = Date.now()): LockRelease | null {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });

  for (let attempt = 0; attempt < 2; attempt++) {
    const token = randomUUID();
    try {
      const descriptor = openSync(file, "wx", 0o600);
      writeSync(descriptor, JSON.stringify({ token, pid: process.pid, createdAt: new Date(now).toISOString() }));
      closeSync(descriptor);
      return () => {
        try {
          const current = JSON.parse(readFileSync(file, "utf8")) as { token?: unknown };
          if (current.token === token) unlinkSync(file);
        } catch {}
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (now - statSync(file).mtimeMs <= staleAfterMs) return null;
        unlinkSync(file);
      } catch (staleError) {
        if ((staleError as NodeJS.ErrnoException).code !== "ENOENT") return null;
      }
    }
  }
  return null;
}

export function acquireSyncLock(): LockRelease | null {
  return acquireFileLock(SYNC_LOCK_PATH, 60 * 60 * 1000);
}
