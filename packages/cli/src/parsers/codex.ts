import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { costUsd, type DailyUsageRow, type ProviderSnapshot } from "@joinburn/shared";
import { normalizeUsageDate } from "../usage";

const CODEX_DIRS = [
  path.join(os.homedir(), ".codex", "sessions"),
  path.join(os.homedir(), ".codex", "archived_sessions"),
];

export function codexDateFromPath(file: string): string | null {
  const normalized = file.replaceAll("\\", "/");
  const directoryDate = normalized.match(/\/sessions\/(\d{4})\/(\d{2})\/(\d{2})\//);
  if (directoryDate) return `${directoryDate[1]}-${directoryDate[2]}-${directoryDate[3]}`;
  const filenameDate = path.basename(file).match(/(\d{4})-(\d{2})-(\d{2})T/);
  return filenameDate ? `${filenameDate[1]}-${filenameDate[2]}-${filenameDate[3]}` : null;
}

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(p);
  }
  return out;
}

const dateKey = (iso: string) => normalizeUsageDate(iso);

type Acc = {
  input: number;
  output: number;
  cacheRead: number;
  messages: number;
  sessions: number;
};

const usageDelta = (prev: any, cur: any) => ({
  input_tokens: Math.max(0, (cur?.input_tokens || 0) - (prev?.input_tokens || 0)),
  cached_input_tokens: Math.max(0, (cur?.cached_input_tokens || 0) - (prev?.cached_input_tokens || 0)),
  output_tokens: Math.max(0, (cur?.output_tokens || 0) - (prev?.output_tokens || 0)),
});

// Codex session JSONL contains true per-turn token counts, so daily rows are
// exact (unlike the Claude cache approximation). Only aggregate counters ever
// leave this function — session content stays on disk.
export async function parseCodex(
  sinceDate?: string,
): Promise<{ rows: DailyUsageRow[]; snapshot: ProviderSnapshot } | null> {
  let files: string[] = [];
  for (const d of CODEX_DIRS) files = files.concat(await walk(d));
  if (sinceDate) {
    files = files.filter((file) => {
      const date = codexDateFromPath(file);
      return date === null || date >= sinceDate;
    });
  }
  if (!files.length) return null;

  const byDayModel = new Map<string, Acc>(); // key: date|model
  const modelTotals = new Map<string, number>();
  const toolCalls: Record<string, number> = {};
  let firstSessionDate: string | null = null;
  let longestSessionMs = 0;
  let longestSessionTurns = 0;
  let totalMessages = 0;
  let totalSessions = 0;

  for (const file of files) {
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch {
      continue;
    }
    let currentModel = "gpt-5.3-codex";
    let lastTotal: any = null;
    let firstTs: string | null = null;
    let lastTs: string | null = null;
    let turnCount = 0;
    let sessionDay: string | null = null;

    for (const line of raw.split("\n")) {
      if (!line) continue;
      let d: any;
      try {
        d = JSON.parse(line);
      } catch {
        continue;
      }
      if (!firstTs && d.timestamp) firstTs = d.timestamp;
      if (d.timestamp) lastTs = d.timestamp;
      const p = d?.payload;
      if (!p) continue;
      if (d.type === "turn_context" && typeof p.model === "string") currentModel = p.model;
      if (p.type === "token_count" && p.info?.total_token_usage) {
        const usage = p.info.last_token_usage || usageDelta(lastTotal, p.info.total_token_usage);
        lastTotal = p.info.total_token_usage;
        const day = d.timestamp ? dateKey(d.timestamp) : null;
        if (!day) continue;
        sessionDay ??= day;
        const key = `${day}|${currentModel}`;
        const acc = byDayModel.get(key) ?? { input: 0, output: 0, cacheRead: 0, messages: 0, sessions: 0 };
        const cached = usage.cached_input_tokens || 0;
        acc.input += Math.max(0, (usage.input_tokens || 0) - cached);
        acc.output += usage.output_tokens || 0;
        acc.cacheRead += cached;
        acc.messages += 1;
        byDayModel.set(key, acc);
        modelTotals.set(
          currentModel,
          (modelTotals.get(currentModel) ?? 0) + (usage.input_tokens || 0) + (usage.output_tokens || 0),
        );
        turnCount++;
        totalMessages++;
      }
      if ((p.type === "function_call" || p.type === "custom_tool_call") && typeof p.name === "string") {
        toolCalls[p.name] = (toolCalls[p.name] || 0) + 1;
      }
    }

    if (turnCount > 0 && firstTs) {
      totalSessions++;
      const day = dateKey(firstTs);
      if (!day) continue;
      const key = `${day}|__session__`;
      const acc = byDayModel.get(key) ?? { input: 0, output: 0, cacheRead: 0, messages: 0, sessions: 0 };
      acc.sessions += 1;
      byDayModel.set(key, acc);
      if (!firstSessionDate || day < firstSessionDate) firstSessionDate = day;
      if (lastTs) {
        const ms = Math.max(0, Date.parse(lastTs) - Date.parse(firstTs));
        if (ms > longestSessionMs) {
          longestSessionMs = ms;
          longestSessionTurns = turnCount;
        }
      }
    }
  }

  const rows: DailyUsageRow[] = [];
  for (const [key, acc] of byDayModel) {
    const [date, model] = key.split("|") as [string, string];
    if (model === "__session__") {
      // Merge session counts into the day's largest model row afterwards.
      continue;
    }
    rows.push({
      date,
      provider: "codex",
      model,
      input: acc.input,
      output: acc.output,
      cacheRead: acc.cacheRead,
      cacheWrite: 0,
      costUsd: costUsd(model, { input: acc.input, output: acc.output, cacheRead: acc.cacheRead }),
      messages: acc.messages,
      sessions: 0,
    });
  }
  // Attach per-day session counts to the first row of that day.
  for (const [key, acc] of byDayModel) {
    const [date, model] = key.split("|") as [string, string];
    if (model !== "__session__" || !acc.sessions) continue;
    const target = rows.find((r) => r.date === date);
    if (target) target.sessions = acc.sessions;
    else
      rows.push({
        date,
        provider: "codex",
        model: "gpt-5.3-codex",
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        costUsd: 0,
        messages: 0,
        sessions: acc.sessions,
      });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));

  const favoriteModel =
    [...modelTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const topTools = Object.entries(toolCalls)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, runs]) => ({ name, runs }));

  const snapshot: ProviderSnapshot = {
    provider: "codex",
    firstSessionDate,
    favoriteModel,
    longestSessionMs,
    longestSessionTurns,
    totalSessions,
    totalMessages,
    topTools,
  };

  return { rows, snapshot };
}
