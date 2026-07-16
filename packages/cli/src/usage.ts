import type { DailyUsageRow, ProviderSnapshot } from "@burnrate/shared";

/** Convert a date or ISO timestamp to the aggregate wire format. */
export function normalizeUsageDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})(?:$|T)/);
  if (!match) return null;
  const date = match[1]!;
  const parsed = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === date ? date : null;
}

/** Keep every parser behind the API's date-only snapshot contract. */
export function normalizeProviderSnapshots(snapshots: ProviderSnapshot[]): ProviderSnapshot[] {
  return snapshots.map((snapshot) => ({
    ...snapshot,
    firstSessionDate: normalizeUsageDate(snapshot.firstSessionDate),
  }));
}

/** Merge duplicate (date, source, model) buckets before a batch reaches the API. */
export function mergeUsageRows(rows: DailyUsageRow[]): DailyUsageRow[] {
  const merged = new Map<string, DailyUsageRow>();
  for (const row of rows) {
    const key = `${row.date}\0${row.provider}\0${row.model}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...row });
      continue;
    }
    existing.input += row.input;
    existing.output += row.output;
    existing.cacheRead += row.cacheRead;
    existing.cacheWrite += row.cacheWrite;
    existing.costUsd += row.costUsd;
    existing.messages += row.messages;
    existing.sessions += row.sessions;
  }
  return [...merged.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model),
  );
}
