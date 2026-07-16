import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { costUsd, type DailyUsageRow, type ProviderSnapshot } from "@burnrate/shared";
import { normalizeUsageDate } from "../usage";

const STATS_CACHE = path.join(os.homedir(), ".claude", "stats-cache.json");

// ~/.claude/stats-cache.json is an undocumented private format — parse
// defensively and fail soft (return null) on anything unexpected.
//
// The cache stores lifetime input/output/cache per MODEL, but per-day it only
// stores a single combined token count per model. We estimate the per-day
// input/output/cache split by applying each model's lifetime ratios to its
// daily totals. Costs inherit the same approximation.
export async function parseClaude(): Promise<{ rows: DailyUsageRow[]; snapshot: ProviderSnapshot } | null> {
  let d: any;
  try {
    d = JSON.parse(await readFile(STATS_CACHE, "utf8"));
  } catch {
    return null;
  }
  if (!d || typeof d !== "object" || !d.modelUsage) return null;

  type Ratio = { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  const ratios: Record<string, Ratio> = {};
  let favoriteModel: string | null = null;
  let favoriteTokens = 0;

  for (const [model, u] of Object.entries<any>(d.modelUsage)) {
    const input = u.inputTokens || 0;
    const output = u.outputTokens || 0;
    const cacheRead = u.cacheReadInputTokens || 0;
    const cacheWrite = u.cacheCreationInputTokens || 0;
    const total = input + output + cacheRead + cacheWrite;
    ratios[model] = { input, output, cacheRead, cacheWrite, total };
    if (total > favoriteTokens) {
      favoriteTokens = total;
      favoriteModel = model;
    }
  }

  const msgByDate: Record<string, number> = {};
  for (const a of d.dailyActivity ?? []) msgByDate[a.date] = a.messageCount || 0;
  const sessByDate: Record<string, number> = {};
  for (const a of d.dailyActivity ?? []) sessByDate[a.date] = a.sessionCount || 0;

  const rows: DailyUsageRow[] = [];
  for (const entry of d.dailyModelTokens ?? []) {
    if (typeof entry?.date !== "string") continue;
    const models = Object.entries<any>(entry.tokensByModel ?? {});
    for (const [i, [model, tokens]] of models.entries()) {
      if (typeof tokens !== "number" || tokens <= 0) continue;
      const r = ratios[model];
      const share = r && r.total > 0 ? tokens / r.total : 0;
      const input = r ? Math.round(r.input * share) : tokens;
      const output = r ? Math.round(r.output * share) : 0;
      const cacheRead = r ? Math.round(r.cacheRead * share) : 0;
      const cacheWrite = r ? Math.round(r.cacheWrite * share) : 0;
      rows.push({
        date: entry.date,
        provider: "claude",
        model,
        input,
        output,
        cacheRead,
        cacheWrite,
        costUsd: costUsd(model, { input, output, cacheRead, cacheWrite }),
        // Attribute the day's message/session counts to the first model row
        // only, so per-day sums stay correct.
        messages: i === 0 ? (msgByDate[entry.date] ?? 0) : 0,
        sessions: i === 0 ? (sessByDate[entry.date] ?? 0) : 0,
      });
    }
  }

  const snapshot: ProviderSnapshot = {
    provider: "claude",
    firstSessionDate: normalizeUsageDate(d.firstSessionDate),
    favoriteModel,
    longestSessionMs: d.longestSession?.duration || 0,
    longestSessionTurns: d.longestSession?.messageCount || 0,
    totalSessions: d.totalSessions || 0,
    totalMessages: d.totalMessages || 0,
    topTools: [],
  };

  return { rows, snapshot };
}
