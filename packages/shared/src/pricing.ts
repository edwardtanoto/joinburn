// USD per million tokens. Collector computes cost locally from this table;
// the server stores what it is sent and never re-prices.
export type ModelPricing = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export const PRICING: Record<string, ModelPricing> = {
  "claude-fable-5":    { input: 10,   output: 50,   cacheRead: 1,     cacheWrite: 12.5 },
  "claude-opus-4-8":   { input: 5,    output: 25,   cacheRead: 0.5,   cacheWrite: 6.25 },
  "claude-opus-4-7":   { input: 5,    output: 25,   cacheRead: 0.5,   cacheWrite: 6.25 },
  "claude-opus-4-6":   { input: 5,    output: 25,   cacheRead: 0.5,   cacheWrite: 6.25 },
  "claude-opus-4-5":   { input: 5,    output: 25,   cacheRead: 0.5,   cacheWrite: 6.25 },
  "claude-sonnet-5":   { input: 2,    output: 10,   cacheRead: 0.2,   cacheWrite: 2.5 },
  "claude-sonnet-4-6": { input: 3,    output: 15,   cacheRead: 0.3,   cacheWrite: 3.75 },
  "claude-sonnet-4-5": { input: 3,    output: 15,   cacheRead: 0.3,   cacheWrite: 3.75 },
  "claude-haiku-4-5":  { input: 1,    output: 5,    cacheRead: 0.1,   cacheWrite: 1.25 },
  "gpt-5.6-sol":       { input: 5,    output: 30,   cacheRead: 0.5,   cacheWrite: 6.25 },
  "gpt-5.6-terra":     { input: 2.5,  output: 15,   cacheRead: 0.25,  cacheWrite: 3.125 },
  "gpt-5.6-luna":      { input: 1,    output: 6,    cacheRead: 0.1,   cacheWrite: 1.25 },
  "gpt-5.5":           { input: 5,    output: 30,   cacheRead: 0.5,   cacheWrite: 0 },
  "gpt-5.5-pro":       { input: 30,   output: 180,  cacheRead: 0,     cacheWrite: 0 },
  "gpt-5.4":           { input: 2.5,  output: 15,   cacheRead: 0.25,  cacheWrite: 0 },
  "gpt-5.4-mini":      { input: 0.75, output: 4.5,  cacheRead: 0.075, cacheWrite: 0 },
  "gpt-5.4-nano":      { input: 0.2,  output: 1.25, cacheRead: 0.02,  cacheWrite: 0 },
  "gpt-5.4-pro":       { input: 30,   output: 180,  cacheRead: 0,     cacheWrite: 0 },
  "gpt-5.3-codex":     { input: 1.75, output: 14,   cacheRead: 0.175, cacheWrite: 0 },
  "gpt-5-codex":       { input: 1.75, output: 14,   cacheRead: 0.175, cacheWrite: 0 },
  unknown:             { input: 0,    output: 0,    cacheRead: 0,     cacheWrite: 0 },
};

export function normalizeModel(model: string): string {
  if (model in PRICING) return model;
  if (model.includes("gpt-5.6-sol")) return "gpt-5.6-sol";
  if (model.includes("gpt-5.6-terra")) return "gpt-5.6-terra";
  if (model.includes("gpt-5.6-luna")) return "gpt-5.6-luna";
  if (model.startsWith("gpt-5.6")) return "gpt-5.6-terra";
  if (model.includes("gpt-5.5-pro")) return "gpt-5.5-pro";
  if (model.startsWith("gpt-5.5")) return "gpt-5.5";
  if (model.includes("gpt-5.4-mini")) return "gpt-5.4-mini";
  if (model.includes("gpt-5.4-nano")) return "gpt-5.4-nano";
  if (model.includes("gpt-5.4-pro")) return "gpt-5.4-pro";
  if (model.startsWith("gpt-5.4")) return "gpt-5.4";
  if (model.includes("codex")) return "gpt-5.3-codex";
  if (model.includes("fable-5")) return "claude-fable-5";
  if (model.includes("opus-4-8")) return "claude-opus-4-8";
  if (model.includes("opus-4-7")) return "claude-opus-4-7";
  if (model.includes("opus-4-6")) return "claude-opus-4-6";
  if (model.includes("opus-4-5")) return "claude-opus-4-5";
  if (model.includes("sonnet-5")) return "claude-sonnet-5";
  if (model.includes("sonnet-4-6")) return "claude-sonnet-4-6";
  if (model.includes("sonnet-4-5")) return "claude-sonnet-4-5";
  if (model.includes("haiku-4-5")) return "claude-haiku-4-5";
  return "unknown";
}

export function costUsd(
  model: string,
  u: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number },
): number {
  const p = PRICING[normalizeModel(model)] ?? PRICING.unknown!;
  return (
    ((u.input ?? 0) * p.input +
      (u.output ?? 0) * p.output +
      (u.cacheRead ?? 0) * p.cacheRead +
      (u.cacheWrite ?? 0) * p.cacheWrite) /
    1_000_000
  );
}
