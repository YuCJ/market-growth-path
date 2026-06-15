import { describe, expect, it } from "vitest";
import {
  calculateRollingReturns,
  estimateTrendReachDate,
  fitDeterministicTrend,
  fitRandomWalkWithDrift,
  generateForecast,
  generateRandomWalkBacktest,
} from "../src/analytics/models";
import type { CanonicalMarketRow } from "../src/analytics/types";
import { parseCanonicalCsv, prepareMarketSeries } from "../src/data/canonicalCsv";
import {
  canonicalDatasets,
  loadCanonicalDataset,
} from "../src/data/canonicalDatasets";

describe("market growth analytics", () => {
  it("estimates 5% annual growth for a deterministic 5% compound series", () => {
    const series = prepareMarketSeries(makeCompoundRows({ years: 12, annualReturn: 0.05 }));
    const trend = fitDeterministicTrend(series);
    const randomWalk = fitRandomWalkWithDrift(series);

    expect(trend.annualizedTrendReturn).toBeCloseTo(0.05, 8);
    expect(randomWalk.annualizedDriftReturn).toBeCloseTo(0.05, 8);
  });

  it("keeps annualized growth unchanged when the whole series is scaled", () => {
    const baseRows = makeCompoundRows({ years: 8, annualReturn: 0.05 });
    const scaledRows = baseRows.map((row) => ({
      ...row,
      total_return_index: row.total_return_index * 17,
    }));

    const base = prepareMarketSeries(baseRows);
    const scaled = prepareMarketSeries(scaledRows);

    expect(fitDeterministicTrend(scaled).annualizedTrendReturn).toBeCloseTo(
      fitDeterministicTrend(base).annualizedTrendReturn,
      12,
    );
    expect(fitRandomWalkWithDrift(scaled).annualizedDriftReturn).toBeCloseTo(
      fitRandomWalkWithDrift(base).annualizedDriftReturn,
      12,
    );
  });

  it("anchors the random walk forecast at the latest actual value after a jump", () => {
    const jumpedRows = makeCompoundRows({ years: 8, annualReturn: 0.05 });
    const latest = jumpedRows[jumpedRows.length - 1];
    latest.total_return_index *= 1.2;
    const series = prepareMarketSeries(jumpedRows);
    const trend = fitDeterministicTrend(series);
    const randomWalk = fitRandomWalkWithDrift(series);
    const forecast = generateForecast(series, randomWalk, 1);

    expect(forecast[0].expected).toBeCloseTo(latest.total_return_index, 12);
    expect(forecast[1].expected).toBeCloseTo(
      latest.total_return_index * Math.exp(randomWalk.mu * forecast[1].hYears),
      12,
    );
    expect(trend.latestTrendIndex).not.toBeCloseTo(latest.total_return_index, 8);
  });

  it("estimates when Model A reaches an above-trend latest index", () => {
    const rows = makeCompoundRows({ years: 8, annualReturn: 0.05 });
    const unjumpedLatest = rows[rows.length - 1].total_return_index;
    rows[rows.length - 1].total_return_index = unjumpedLatest * 1.2;
    const series = prepareMarketSeries(rows);
    const trend = fitDeterministicTrend(series);
    const reachDate = estimateTrendReachDate(
      series,
      trend,
      rows[rows.length - 1].total_return_index,
    );

    expect(reachDate).not.toBeNull();
    expect(reachDate!.yearsFromLatest).toBeGreaterThan(0);
    expect(reachDate!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("does not estimate a future reach date when the latest index is not above Model A", () => {
    const series = prepareMarketSeries(makeCompoundRows({ years: 8, annualReturn: 0.05 }));
    const trend = fitDeterministicTrend(series);

    expect(
      estimateTrendReachDate(
        series,
        trend,
        series.rows[series.rows.length - 1].total_return_index,
      ),
    ).toBeNull();
  });

  it("uses elapsed-time weighted drift for irregular dates", () => {
    const series = prepareMarketSeries([
      { date: "2020-01-01", total_return_index: 100 },
      { date: "2020-01-08", total_return_index: 110 },
      { date: "2021-01-01", total_return_index: 130 },
    ]);
    const randomWalk = fitRandomWalkWithDrift(series);
    const expected =
      Math.log(130 / 100) /
      ((new Date("2021-01-01T00:00:00.000Z").getTime() -
        new Date("2020-01-01T00:00:00.000Z").getTime()) /
        86_400_000 /
        365.2425);

    expect(randomWalk.mu).toBeCloseTo(expected, 12);
  });

  it("calculates rolling annualized returns with date windows", () => {
    const series = prepareMarketSeries(makeCompoundRows({ years: 7, annualReturn: 0.05 }));
    const rolling = calculateRollingReturns(series, [5]);
    const latest = rolling[rolling.length - 1];

    expect(latest.returns[5]).toBeCloseTo(0.05, 3);
  });

  it("rejects non-positive total return index values", () => {
    expect(() =>
      parseCanonicalCsv("date,total_return_index\n2024-01-01,100\n2024-01-02,0\n"),
    ).toThrow("total_return_index must be greater than 0");
  });

  it("detects registered canonical datasets as weekly", () => {
    const frequencies = canonicalDatasets.map(
      (dataset) => loadCanonicalDataset(dataset).series.frequency,
    );

    expect(frequencies).toEqual(["weekly", "weekly"]);
  });

  it("widens forecast intervals with horizon and keeps 95% wider than 80%", () => {
    const series = prepareMarketSeries([
      { date: "2020-01-03", total_return_index: 100 },
      { date: "2021-01-03", total_return_index: 130 },
      { date: "2022-01-03", total_return_index: 105 },
      { date: "2023-01-03", total_return_index: 150 },
    ]);
    const forecast = generateForecast(series, fitRandomWalkWithDrift(series), 3);
    const early = forecast.find((point) => point.hYears > 0)!;
    const late = forecast[forecast.length - 1];

    expect(early.upper95 - early.lower95).toBeGreaterThan(
      early.upper80 - early.lower80,
    );
    expect(late.upper95 - late.lower95).toBeGreaterThan(
      early.upper95 - early.lower95,
    );
  });

  it("calculates a twelve-month random walk backtest from information at the origin", () => {
    const rows = makeCompoundRows({ years: 4, annualReturn: 0.05 });
    const unjumpedLatest = rows[rows.length - 1].total_return_index;
    rows[rows.length - 1].total_return_index *= 1.2;
    const series = prepareMarketSeries(rows);
    const backtest = generateRandomWalkBacktest(series, 12);

    expect(backtest).not.toBeNull();
    expect(backtest!.lookbackMonths).toBe(12);
    expect(backtest!.originDate).toBe("2023-01-01");
    expect(backtest!.expectedLatest).toBeCloseTo(unjumpedLatest, 8);
    expect(backtest!.actualLatest).toBeCloseTo(unjumpedLatest * 1.2, 8);
    expect(backtest!.gap).toBeCloseTo(0.2, 8);
    expect(backtest!.annualizedDriftReturnAtOrigin).toBeCloseTo(0.05, 8);
    expect(backtest!.inside80).toBe(false);
    expect(backtest!.inside95).toBe(false);
  });

  it("selects the latest available origin not after the month lookback date", () => {
    const series = prepareMarketSeries([
      { date: "2020-01-01", total_return_index: 100 },
      { date: "2021-01-01", total_return_index: 110 },
      { date: "2021-07-01", total_return_index: 115 },
      { date: "2022-01-01", total_return_index: 120 },
    ]);
    const backtest = generateRandomWalkBacktest(series, 6);

    expect(backtest).not.toBeNull();
    expect(backtest!.lookbackMonths).toBe(6);
    expect(backtest!.originDate).toBe("2021-07-01");
  });
});

function makeCompoundRows({
  years,
  annualReturn,
}: {
  years: number;
  annualReturn: number;
}): CanonicalMarketRow[] {
  const logReturn = Math.log(1 + annualReturn);
  const firstDate = new Date("2020-01-01T00:00:00.000Z");
  return Array.from({ length: years + 1 }, (_, index) => ({
    date: `${2020 + index}-01-01`,
    total_return_index:
      100 *
      Math.exp(
        logReturn *
          ((new Date(`${2020 + index}-01-01T00:00:00.000Z`).getTime() -
            firstDate.getTime()) /
            86_400_000 /
            365.2425),
      ),
  }));
}
