import { describe, expect, test } from "bun:test";
import { mergeUsageRows, normalizeProviderSnapshots, normalizeUsageDate } from "./usage";

describe("normalizeUsageDate", () => {
  test("keeps date-only values and strips valid ISO timestamps", () => {
    expect(normalizeUsageDate("2026-07-15")).toBe("2026-07-15");
    expect(normalizeUsageDate("2026-07-15T12:34:56.789Z")).toBe("2026-07-15");
  });

  test("rejects malformed and impossible dates", () => {
    expect(normalizeUsageDate("2026-02-30T12:00:00Z")).toBeNull();
    expect(normalizeUsageDate("not-a-date")).toBeNull();
  });
});

describe("normalizeProviderSnapshots", () => {
  test("normalizes parser timestamps before they reach the API", () => {
    const snapshot = {
      provider: "codex" as const,
      firstSessionDate: "2026-04-21T17:19:54.121Z",
      favoriteModel: "gpt-test",
      longestSessionMs: 1,
      longestSessionTurns: 1,
      totalSessions: 1,
      totalMessages: 1,
      topTools: [],
    };
    expect(normalizeProviderSnapshots([snapshot])[0]?.firstSessionDate).toBe("2026-04-21");
  });
});

describe("mergeUsageRows", () => {
  test("combines duplicate agent/model buckets without mixing agents", () => {
    const row = {
      date: "2026-07-15",
      provider: "codex" as const,
      model: "gpt-test",
      input: 10,
      output: 5,
      cacheRead: 2,
      cacheWrite: 1,
      costUsd: 0.1,
      messages: 1,
      sessions: 1,
    };
    expect(mergeUsageRows([row, { ...row, input: 20, sessions: 0 }])).toEqual([
      { ...row, input: 30, output: 10, cacheRead: 4, cacheWrite: 2, costUsd: 0.2, messages: 2, sessions: 1 },
    ]);
  });
});
