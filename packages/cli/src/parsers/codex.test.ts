import { describe, expect, test } from "bun:test";
import { codexDateFromPath } from "./codex";

describe("codexDateFromPath", () => {
  test("reads dates from active session directories", () => {
    expect(codexDateFromPath("/Users/dev/.codex/sessions/2026/07/12/rollout.jsonl")).toBe("2026-07-12");
  });

  test("reads dates from archived session filenames", () => {
    expect(codexDateFromPath("/Users/dev/.codex/archived_sessions/rollout-2026-06-30T12-00-00.jsonl")).toBe(
      "2026-06-30",
    );
  });

  test("keeps unknown layouts eligible for safe rescans", () => {
    expect(codexDateFromPath("/Users/dev/.codex/sessions/legacy/session.jsonl")).toBeNull();
  });
});
