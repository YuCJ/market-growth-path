import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fitDeterministicTrend } from "../src/analytics/models.ts";
import type { DeterministicTrendResult, MarketObservation } from "../src/analytics/types.ts";
import { parseCanonicalCsv, prepareMarketSeries } from "../src/data/canonicalCsv.ts";
import { sendTextMessage } from "../src/telegram.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type LatestTrendAlert = {
  shouldAlert: boolean;
  symbol: string;
  latest: MarketObservation;
  latestTrendIndex: number;
  deviation: number;
  thresholdPercent: number;
  trend: DeterministicTrendResult;
};

async function main(): Promise<void> {
  await loadDotEnv();

  const symbol = process.env.MARKET_DATA_SYMBOL ?? "VT";
  const alertThresholdPercent = parseAlertThresholdPercent(
    process.env.MARKET_TREND_ALERT_THRESHOLD_PERCENT,
  );
  const canonicalPath = resolve(
    repoRoot,
    "data",
    "canonical",
    `market-total-return-${symbol.toLowerCase()}-weekly.v1.csv`,
  );
  const csv = await readFile(canonicalPath, "utf8");
  const alert = buildLatestTrendAlert({
    csv,
    symbol,
    thresholdPercent: alertThresholdPercent,
  });

  if (!alert.shouldAlert) {
    console.log(
      `No trend alert for ${symbol}: latest actual is ${formatPercent(alert.deviation)} vs Model A.`,
    );
    return;
  }

  const token = getRequiredEnv("TELEGRAM_BOT_TOKEN");
  const chatId = getRequiredEnv("TELEGRAM_CHAT_ID");
  await sendTextMessage(token, chatId, formatLatestTrendAlert(alert));
  console.log(`Sent trend alert for ${symbol}.`);
}

export function buildLatestTrendAlert({
  csv,
  symbol,
  thresholdPercent,
}: {
  csv: string;
  symbol: string;
  thresholdPercent: number;
}): LatestTrendAlert {
  const series = prepareMarketSeries(parseCanonicalCsv(csv));
  const trend = fitDeterministicTrend(series);
  const latest = series.rows[series.rows.length - 1];
  const deviation = latest.total_return_index / trend.latestTrendIndex - 1;

  return {
    shouldAlert: shouldSendLatestTrendAlert(deviation, thresholdPercent),
    symbol,
    latest,
    latestTrendIndex: trend.latestTrendIndex,
    deviation,
    thresholdPercent,
    trend,
  };
}

export function shouldSendLatestTrendAlert(
  deviation: number,
  thresholdPercent: number,
): boolean {
  return deviation <= thresholdPercent / 100;
}

export function parseAlertThresholdPercent(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return 2;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("MARKET_TREND_ALERT_THRESHOLD_PERCENT must be a non-negative number.");
  }
  return parsed;
}

function formatLatestTrendAlert(alert: LatestTrendAlert): string {
  return [
    `Market trend alert: ${alert.symbol}`,
    `Date: ${alert.latest.date}`,
    `Actual index: ${formatNumber(alert.latest.total_return_index)}`,
    `Model A trend index: ${formatNumber(alert.latestTrendIndex)}`,
    `Actual vs Model A: ${formatPercent(alert.deviation)}`,
    `Alert threshold: at or below +${formatNumber(alert.thresholdPercent)}%`,
    `Model A annualized trend return: ${formatPercent(alert.trend.annualizedTrendReturn)}`,
  ].join("\n");
}

async function loadDotEnv(): Promise<void> {
  const envPath = resolve(repoRoot, ".env");
  let contents = "";
  try {
    contents = await readFile(envPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = unquoteEnvValue(value);
    }
  }
}

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
}

function formatPercent(value: number): string {
  return `${formatNumber(value * 100)}%`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
