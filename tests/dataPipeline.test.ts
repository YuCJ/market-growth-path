import { describe, expect, it } from "vitest";
import {
  buildLatestTrendAlert,
  parseAlertThresholdPercent,
  shouldSendLatestTrendAlert,
} from "../scripts/checkLatestTrendAlert";
import { getUtcIsoWeekStartDate } from "../scripts/fetchHistoricalData";
import { buildCanonicalSeries } from "../src/data/pipeline/buildCanonicalSeries";
import { canonicalRowsToCsv, sourceRowsToCsv } from "../src/data/pipeline/csv";
import { validateSourceMarketRows } from "../src/data/pipeline/validateMarketRows";
import { parseAlphaVantageWeeklyAdjustedResponse } from "../src/data/providers/alphaVantage";
import type { SourceMarketRow } from "../src/data/providers/types";

describe("Alpha Vantage weekly adjusted parser", () => {
  it("parses rows sorted from oldest to newest", () => {
    const rows = parseAlphaVantageWeeklyAdjustedResponse(
      {
        "Weekly Adjusted Time Series": {
          "2024-01-12": {
            "1. open": "101.00",
            "2. high": "103.00",
            "3. low": "100.00",
            "4. close": "102.00",
            "5. adjusted close": "102.00",
            "6. volume": "2000",
            "7. dividend amount": "0.1000",
          },
          "2024-01-05": {
            "1. open": "99.00",
            "2. high": "101.00",
            "3. low": "98.00",
            "4. close": "100.00",
            "5. adjusted close": "100.00",
            "6. volume": "1000",
            "7. dividend amount": "0.0000",
          },
        },
      },
      { symbol: "VT" },
    );

    expect(rows.map((row) => row.date)).toEqual(["2024-01-05", "2024-01-12"]);
    expect(rows[0]).toMatchObject({
      provider: "alpha-vantage",
      symbol: "VT",
      adjusted_close: 100,
      dividend_amount: 0,
    });
  });

  it("surfaces provider error payloads", () => {
    expect(() =>
      parseAlphaVantageWeeklyAdjustedResponse(
        { "Error Message": "Invalid API call." },
        { symbol: "VT" },
      ),
    ).toThrow("Invalid API call.");
  });
});

describe("source market row validation", () => {
  it("rejects duplicate dates", () => {
    expect(() =>
      validateSourceMarketRows([
        makeRow({ date: "2024-01-05" }),
        makeRow({ date: "2024-01-05" }),
      ]),
    ).toThrow("Duplicate date");
  });

  it("rejects non-positive adjusted close values", () => {
    expect(() =>
      validateSourceMarketRows([
        makeRow({ date: "2024-01-05", adjusted_close: 0 }),
      ]),
    ).toThrow("Adjusted close must be greater than 0");
  });
});

describe("canonical market series", () => {
  it("rebases adjusted close to a total-return-like index", () => {
    const canonical = buildCanonicalSeries([
      makeRow({ date: "2024-01-05", adjusted_close: 50 }),
      makeRow({ date: "2024-01-12", adjusted_close: 75 }),
      makeRow({ date: "2024-01-19", adjusted_close: 100 }),
    ]);

    expect(canonical.map((row) => row.total_return_index)).toEqual([
      100, 150, 200,
    ]);
    expect(canonical[0]).toMatchObject({
      source_value: 50,
      provider: "alpha-vantage",
      symbol: "VT",
      source_field: "adjusted_close",
    });
  });
});

describe("CSV serialization", () => {
  it("writes stable source and canonical headers", () => {
    const source = [makeRow({ date: "2024-01-05", adjusted_close: 100 })];
    const canonical = buildCanonicalSeries(source);

    expect(sourceRowsToCsv(source).split("\n")[0]).toBe(
      "date,provider,symbol,open,high,low,close,adjusted_close,volume,dividend_amount",
    );
    expect(canonicalRowsToCsv(canonical).split("\n")[0]).toBe(
      "date,total_return_index,source_value,provider,symbol,source_field",
    );
  });
});

describe("dataset snapshot cadence", () => {
  it("uses a stable UTC weekly bucket for automated snapshots", () => {
    expect(getUtcIsoWeekStartDate(new Date("2026-06-08T00:00:00.000Z"))).toBe(
      "2026-06-08",
    );
    expect(getUtcIsoWeekStartDate(new Date("2026-06-14T23:59:59.999Z"))).toBe(
      "2026-06-08",
    );
  });
});

describe("latest trend alert", () => {
  it("alerts when latest actual index is near or below Model A trend", () => {
    expect(shouldSendLatestTrendAlert(0.02, 2)).toBe(true);
    expect(shouldSendLatestTrendAlert(0.0201, 2)).toBe(false);
    expect(shouldSendLatestTrendAlert(-0.05, 2)).toBe(true);
  });

  it("defaults trend proximity threshold to 2 percent", () => {
    expect(parseAlertThresholdPercent(undefined)).toBe(2);
    expect(parseAlertThresholdPercent("")).toBe(2);
    expect(parseAlertThresholdPercent("0")).toBe(0);
  });

  it("builds latest trend alert from canonical CSV", () => {
    const alert = buildLatestTrendAlert({
      symbol: "TEST",
      thresholdPercent: 2,
      csv: [
        "date,total_return_index",
        "2020-01-01,100",
        "2021-01-01,110",
        "2022-01-01,121",
        "2023-01-01,120",
      ].join("\n"),
    });

    expect(alert.latest.date).toBe("2023-01-01");
    expect(alert.latestTrendIndex).toBeGreaterThan(0);
    expect(alert.shouldAlert).toBe(true);
  });
});

function makeRow(overrides: Partial<SourceMarketRow> = {}): SourceMarketRow {
  return {
    date: "2024-01-05",
    provider: "alpha-vantage",
    symbol: "VT",
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    adjusted_close: 100,
    volume: 1000,
    dividend_amount: 0,
    ...overrides,
  };
}
