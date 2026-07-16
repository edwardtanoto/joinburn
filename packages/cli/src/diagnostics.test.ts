import { describe, expect, test } from "bun:test";
import { CollectorHttpError } from "./http";
import { classifyCollectorError, collectorDoctorResult, inspectCollectorApi } from "./diagnostics";

describe("collector diagnostics", () => {
  test("reduces failures to privacy-safe repair categories", () => {
    expect(classifyCollectorError(new CollectorHttpError("revoked", 401, null))).toBe("authentication");
    expect(classifyCollectorError(new CollectorHttpError("slow down", 429, null))).toBe("rate_limited");
    expect(classifyCollectorError(new CollectorHttpError("down", 503, null))).toBe("service");
    expect(classifyCollectorError(new TypeError("fetch failed"))).toBe("network");
    expect(classifyCollectorError(new Error("ccusage integrity mismatch"))).toBe("parser");
    expect(classifyCollectorError(Object.assign(new Error("write failed"), { code: "ENOSPC" }))).toBe("filesystem");
    expect(classifyCollectorError(new Error("launchctl could not load daemon"))).toBe("scheduler");
    expect(classifyCollectorError(new Error("something new"))).toBe("unknown");
  });

  test("checks API authorization without uploading collector details", async () => {
    const config = {
      apiBase: "https://api.example",
      deviceToken: "x".repeat(32),
      username: "burner",
      lastSyncDate: null,
    };
    let request: Request | null = null;
    const state = await inspectCollectorApi(config, async (input, init) => {
      request = input instanceof Request ? input : new Request(input.toString(), init);
      return Response.json({ ok: true });
    });
    expect(state).toBe("reachable");
    expect(request!.url).toBe("https://api.example/v1/collector/ping");
    expect(request!.method).toBe("GET");
    expect(await request!.text()).toBe("");

    expect(await inspectCollectorApi(config, async () => new Response(null, { status: 401 }))).toBe("authentication");
    expect(await inspectCollectorApi(config, async () => { throw new TypeError("offline"); })).toBe("network");
  });

  test("directs an unconfigured collector to connect instead of repair", async () => {
    const report = await collectorDoctorResult(null);

    expect(report.connected).toBe(false);
    expect(report.apiState).toBe("unconfigured");
    expect(report.recommendedAction).toBe("connect");
    expect(report.command).toBe("npx --yes joinburn@latest connect --code <PAIRING_CODE>");
  });
});
