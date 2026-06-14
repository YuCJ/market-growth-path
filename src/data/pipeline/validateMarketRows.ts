import type { SourceMarketRow } from "../providers/types.ts";

export function validateSourceMarketRows(rows: SourceMarketRow[]): void {
  if (rows.length === 0) {
    throw new Error("Source market data is empty.");
  }

  const seenDates = new Set<string>();
  let previousDate = "";

  for (const row of rows) {
    if (!isIsoDate(row.date)) {
      throw new Error(`Invalid ISO date: ${row.date}`);
    }
    if (seenDates.has(row.date)) {
      throw new Error(`Duplicate date: ${row.date}`);
    }
    if (previousDate && row.date <= previousDate) {
      throw new Error(
        `Rows must be sorted ascending by date: ${previousDate} before ${row.date}`,
      );
    }
    if (row.adjusted_close <= 0) {
      throw new Error(
        `Adjusted close must be greater than 0 for ${row.date}: ${row.adjusted_close}`,
      );
    }

    seenDates.add(row.date);
    previousDate = row.date;
  }
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}
