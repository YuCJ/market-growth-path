type CsvValue = string | number;

export function toCsv<T extends Record<string, CsvValue>>(
  rows: T[],
  columns: readonly (keyof T)[],
): string {
  const header = columns.map(String).join(",");
  const body = rows.map((row) =>
    columns.map((column) => escapeCsvValue(row[column])).join(","),
  );
  return [header, ...body].join("\n") + "\n";
}

export function sourceRowsToCsv(
  rows: {
    date: string;
    provider: string;
    symbol: string;
    open: number;
    high: number;
    low: number;
    close: number;
    adjusted_close: number;
    volume: number;
    dividend_amount: number;
  }[],
): string {
  return toCsv(rows, [
    "date",
    "provider",
    "symbol",
    "open",
    "high",
    "low",
    "close",
    "adjusted_close",
    "volume",
    "dividend_amount",
  ]);
}

export function canonicalRowsToCsv(
  rows: {
    date: string;
    total_return_index: number;
    source_value: number;
    provider: string;
    symbol: string;
    source_field: string;
  }[],
): string {
  return toCsv(rows, [
    "date",
    "total_return_index",
    "source_value",
    "provider",
    "symbol",
    "source_field",
  ]);
}

function escapeCsvValue(value: CsvValue): string {
  const raw = typeof value === "number" ? formatNumber(value) : value;
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replaceAll('"', '""')}"`;
  }
  return raw;
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(6).replace(/\.?0+$/, "");
}

