import { describe, expect, test } from "bun:test";
import { postJson } from "./http";

describe("postJson", () => {
  test("retries transient server failures with bounded backoff", async () => {
    let calls = 0;
    const delays: number[] = [];
    const result = await postJson<{ ok: boolean }>("https://api.example", "/v1/ingest", {}, "secret", {
      attempts: 3,
      fetcher: (async () => {
        calls++;
        return calls === 1
          ? new Response(JSON.stringify({ error: { message: "try again" } }), { status: 503 })
          : Response.json({ ok: true });
      }),
      random: () => 0,
      sleep: async (milliseconds) => { delays.push(milliseconds); },
    });
    expect(result).toEqual({ ok: true });
    expect(calls).toBe(2);
    expect(delays).toEqual([500]);
  });

  test("does not retry permanent client failures", async () => {
    let calls = 0;
    await expect(postJson("https://api.example", "/v1/ingest", {}, undefined, {
      attempts: 4,
      fetcher: (async () => {
        calls++;
        return new Response(JSON.stringify({ error: { message: "bad payload" } }), { status: 400 });
      }),
      sleep: async () => undefined,
    })).rejects.toEqual(expect.objectContaining({ status: 400, message: "bad payload" }));
    expect(calls).toBe(1);
  });

  test("surfaces safe validation paths from collector contract failures", async () => {
    await expect(postJson("https://api.example", "/v1/ingest", {}, undefined, {
      fetcher: (async () => new Response(JSON.stringify({
        error: {
          message: "bad payload",
          issues: [{ path: "snapshots.0.firstSessionDate", message: "Use YYYY-MM-DD." }],
        },
      }), { status: 400 })),
    })).rejects.toEqual(expect.objectContaining({
      message: "bad payload snapshots.0.firstSessionDate: Use YYYY-MM-DD.",
    }));
  });
});
