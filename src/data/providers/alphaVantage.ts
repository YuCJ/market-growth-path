import type {
  MarketDataProvider,
  MarketDataRequest,
  SourceMarketRow,
} from "./types.ts";

const WEEKLY_ADJUSTED_KEY = "Weekly Adjusted Time Series";

type AlphaVantageWeeklyAdjustedPoint = {
  "1. open": string;
  "2. high": string;
  "3. low": string;
  "4. close": string;
  "5. adjusted close": string;
  "6. volume": string;
  "7. dividend amount": string;
};

type AlphaVantageWeeklyAdjustedResponse = {
  [WEEKLY_ADJUSTED_KEY]?: Record<string, AlphaVantageWeeklyAdjustedPoint>;
  "Error Message"?: string;
  "Information"?: string;
  "Note"?: string;
};

export class AlphaVantageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlphaVantageError";
  }
}

/**
 * Alpha Vantage answers with HTTP 200 and a text message when a free key sends
 * requests faster than one per second. That message is worth retrying; the
 * daily-quota message is not, because waiting a few seconds will not help.
 */
export function isAlphaVantageBurstLimitMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  // The daily-quota message names a detected key and states the limit; the
  // burst message only advertises the daily limit as a paid upgrade, so match
  // the quota wording first.
  const isDailyQuotaExhausted =
    normalized.includes("we have detected your api key") ||
    normalized.includes("rate limit is");
  if (isDailyQuotaExhausted) {
    return false;
  }
  return (
    normalized.includes("1 request per second") ||
    normalized.includes("higher api call frequency")
  );
}

export function parseAlphaVantageWeeklyAdjustedResponse(
  payload: unknown,
  request: MarketDataRequest,
): SourceMarketRow[] {
  if (!isRecord(payload)) {
    throw new AlphaVantageError("Alpha Vantage returned a non-object payload.");
  }

  const response = payload as AlphaVantageWeeklyAdjustedResponse;
  const apiMessage =
    response["Error Message"] ?? response.Information ?? response.Note;
  if (apiMessage) {
    throw new AlphaVantageError(apiMessage);
  }

  const series = response[WEEKLY_ADJUSTED_KEY];
  if (!series || !isRecord(series)) {
    throw new AlphaVantageError(
      `Alpha Vantage response did not include "${WEEKLY_ADJUSTED_KEY}".`,
    );
  }

  return Object.entries(series)
    .map(([date, point]) => ({
      date,
      provider: "alpha-vantage" as const,
      symbol: request.symbol,
      open: parseFiniteNumber(point["1. open"], date, "open"),
      high: parseFiniteNumber(point["2. high"], date, "high"),
      low: parseFiniteNumber(point["3. low"], date, "low"),
      close: parseFiniteNumber(point["4. close"], date, "close"),
      adjusted_close: parseFiniteNumber(
        point["5. adjusted close"],
        date,
        "adjusted_close",
      ),
      volume: parseFiniteNumber(point["6. volume"], date, "volume"),
      dividend_amount: parseFiniteNumber(
        point["7. dividend amount"],
        date,
        "dividend_amount",
      ),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

const BURST_RETRY_DELAYS_MS = [2_000, 5_000, 15_000];

export function createAlphaVantageProvider(apiKey: string): MarketDataProvider {
  return {
    id: "alpha-vantage",
    async fetchWeeklyAdjustedSeries(
      request: MarketDataRequest,
    ): Promise<SourceMarketRow[]> {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await fetchOnce(apiKey, request);
        } catch (error) {
          const retryable =
            error instanceof AlphaVantageError &&
            isAlphaVantageBurstLimitMessage(error.message) &&
            attempt < BURST_RETRY_DELAYS_MS.length;
          if (!retryable) {
            throw error;
          }
          const delayMs = BURST_RETRY_DELAYS_MS[attempt];
          console.warn(
            `Alpha Vantage throttled the request for ${request.symbol}; retrying in ${delayMs}ms.`,
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    },
  };
}

async function fetchOnce(
  apiKey: string,
  request: MarketDataRequest,
): Promise<SourceMarketRow[]> {
  const url = new URL("https://www.alphavantage.co/query");
  url.searchParams.set("function", "TIME_SERIES_WEEKLY_ADJUSTED");
  url.searchParams.set("symbol", request.symbol);
  url.searchParams.set("apikey", apiKey);

  const response = await fetch(url);
  if (!response.ok) {
    throw new AlphaVantageError(
      `Alpha Vantage HTTP ${response.status}: ${response.statusText}`,
    );
  }

  const payload: unknown = await response.json();
  return parseAlphaVantageWeeklyAdjustedResponse(payload, request);
}

function parseFiniteNumber(value: string, date: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new AlphaVantageError(
      `Invalid ${field} value for ${date}: ${String(value)}`,
    );
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
