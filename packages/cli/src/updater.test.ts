import { describe, expect, test } from "bun:test";
import { isNewerVersion } from "./updater";

describe("isNewerVersion", () => {
  test("only accepts a strictly newer stable collector version", () => {
    expect(isNewerVersion("0.1.1", "0.1.0")).toBe(true);
    expect(isNewerVersion("0.2.0", "0.1.9")).toBe(true);
    expect(isNewerVersion("0.2.1", "0.2.0")).toBe(true);
    expect(isNewerVersion("0.1.0", "0.1.0")).toBe(false);
    expect(isNewerVersion("0.0.9", "0.1.0")).toBe(false);
    expect(isNewerVersion("latest", "0.1.0")).toBe(false);
  });
});
