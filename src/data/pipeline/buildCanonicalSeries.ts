import type { SourceMarketRow } from "../providers/types.ts";
import { validateSourceMarketRows } from "./validateMarketRows.ts";

export type CanonicalMarketSeriesRow = {
  date: string;
  total_return_index: number;
  source_value: number;
  provider: string;
  symbol: string;
  source_field: "adjusted_close";
};

export function buildCanonicalSeries(
  rows: SourceMarketRow[],
): CanonicalMarketSeriesRow[] {
  validateSourceMarketRows(rows);

  const baseValue = rows[0]?.adjusted_close;
  if (!baseValue || baseValue <= 0) {
    throw new Error("Cannot build canonical series without a positive base value.");
  }

  return rows.map((row) => ({
    date: row.date,
    total_return_index: (row.adjusted_close / baseValue) * 100,
    source_value: row.adjusted_close,
    provider: row.provider,
    symbol: row.symbol,
    source_field: "adjusted_close",
  }));
}
