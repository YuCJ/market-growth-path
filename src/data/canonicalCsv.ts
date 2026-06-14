import { detectFrequency, elapsedYears, parseIsoDate } from "../analytics/time";
import type {
  CanonicalMarketRow,
  PreparedMarketSeries,
} from "../analytics/types";

export function parseCanonicalCsv(csv: string): CanonicalMarketRow[] {
  const [headerLine, ...lines] = csv.trim().split(/\r?\n/);
  if (!headerLine) {
    throw new Error("Canonical CSV is empty.");
  }

  const headers = splitCsvLine(headerLine);
  const required = ["date", "total_return_index"] as const;
  for (const column of required) {
    if (!headers.includes(column)) {
      throw new Error(`Canonical CSV is missing required column: ${column}`);
    }
  }

  const byDate = new Map<string, CanonicalMarketRow>();
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    const values = splitCsvLine(line);
    const record = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    const date = record.date;
    const totalReturnIndex = Number(record.total_return_index);

    if (!Number.isFinite(totalReturnIndex) || totalReturnIndex <= 0) {
      throw new Error(`total_return_index must be greater than 0 for ${date}.`);
    }

    byDate.set(date, {
      date,
      total_return_index: totalReturnIndex,
      source_value: parseOptionalNumber(record.source_value),
      provider: record.provider || undefined,
      symbol: record.symbol || undefined,
      source_field: record.source_field || undefined,
    });
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function prepareMarketSeries(rows: CanonicalMarketRow[]): PreparedMarketSeries {
  if (rows.length < 2) {
    throw new Error("At least two canonical rows are required.");
  }

  const dateObjs = rows.map((row) => parseIsoDate(row.date));
  const { frequency, maxGapDays, unusualGapCount } = detectFrequency(dateObjs);
  const firstDate = dateObjs[0];
  const lastDate = dateObjs[dateObjs.length - 1];

  return {
    rows: rows.map((row, index) => ({
      ...row,
      dateObj: dateObjs[index],
      yearsSinceStart: elapsedYears(firstDate, dateObjs[index]),
      logIndex: Math.log(row.total_return_index),
    })),
    frequency,
    sampleYears: elapsedYears(firstDate, lastDate),
    maxGapDays,
    unusualGapCount,
  };
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function splitCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  values.push(current);
  return values;
}
