import { describe, expect, it } from "vitest";
import {
  calculateRollingReturns,
  estimateTrendReachDate,
  fitDeterministicTrend,
  findLastRowIndexOnOrBefore,
  fitBrokenTrend,
  generateBrokenTrendExtension,
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

    expect(trend.annualizedTrendReturn).toBeCloseTo(0.05, 8);
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
    const scaledBroken = fitBrokenTrend(scaled, "2024-01-01")!;
    const baseBroken = fitBrokenTrend(base, "2024-01-01")!;
    expect(scaledBroken.annualizedReturnAfter).toBeCloseTo(
      baseBroken.annualizedReturnAfter,
      10,
    );
    expect(scaledBroken.currentDeviation).toBeCloseTo(
      baseBroken.currentDeviation,
      10,
    );
  });

  it("does not force Model A through the latest value after a jump", () => {
    const jumpedRows = makeCompoundRows({ years: 8, annualReturn: 0.05 });
    const latest = jumpedRows[jumpedRows.length - 1];
    latest.total_return_index *= 1.2;
    const trend = fitDeterministicTrend(prepareMarketSeries(jumpedRows));

    expect(trend.latestTrendIndex).not.toBeCloseTo(latest.total_return_index, 8);
  });

  it("recovers both growth rates when growth changes on the break date", () => {
    const series = prepareMarketSeries(
      makeTwoRateRows({ years: 12, changeYear: 2028, before: 0.05, after: 0.12 }),
    );
    const broken = fitBrokenTrend(series, "2028-01-01")!;

    expect(broken.breakDate).toBe("2028-01-01");
    expect(broken.annualizedReturnBefore).toBeCloseTo(0.05, 8);
    expect(broken.annualizedReturnAfter).toBeCloseTo(0.12, 8);
    expect(broken.yearsAfterBreak).toBeCloseTo(4, 2);
    expect(broken.currentDeviation).toBeCloseTo(0, 8);
    // The line bends on the break date without jumping.
    expect(broken.fitted[broken.breakIndex].deviation).toBeCloseTo(0, 8);
  });

  it("gives the same rate on both sides when growth never changed", () => {
    const series = prepareMarketSeries(makeCompoundRows({ years: 12, annualReturn: 0.05 }));
    const broken = fitBrokenTrend(series, "2026-01-01")!;

    expect(broken.annualizedReturnBefore).toBeCloseTo(0.05, 8);
    expect(broken.annualizedReturnAfter).toBeCloseTo(0.05, 8);
  });

  it("extends the broken trend at the growth rate after the break", () => {
    const series = prepareMarketSeries(
      makeTwoRateRows({ years: 12, changeYear: 2028, before: 0.05, after: 0.12 }),
    );
    const broken = fitBrokenTrend(series, "2028-01-01")!;
    const extension = generateBrokenTrendExtension(series, broken, 2);
    const last = extension[extension.length - 1];

    expect(extension[0].trendIndex).toBeCloseTo(broken.latestTrendIndex, 8);
    expect(last.date).toBe("2034-01-01");
    expect(last.trendIndex / extension[0].trendIndex).toBeCloseTo(1.12 ** 2, 3);
  });

  it("has no broken trend when either side of the break has under three rows", () => {
    const series = prepareMarketSeries(makeCompoundRows({ years: 8, annualReturn: 0.05 }));

    expect(fitBrokenTrend(series, "2021-06-01")).toBeNull();
    expect(fitBrokenTrend(series, "2019-01-01")).toBeNull();
    expect(fitBrokenTrend(series, "2026-06-01")).toBeNull();
    expect(fitBrokenTrend(series, "2025-06-01")).not.toBeNull();
  });

  it("reports a wider growth-rate error when fewer years follow the break", () => {
    const series = loadCanonicalDataset(canonicalDatasets[0]).series;
    const early = fitBrokenTrend(series, "2018-01-01")!;
    const late = fitBrokenTrend(series, "2022-11-30")!;

    expect(late.annualizedReturnAfterUncertainty).toBeGreaterThan(early.annualizedReturnAfterUncertainty);
    expect(late.annualizedReturnAfterUncertainty).toBeGreaterThan(0.05);
    expect(late.annualizedReturnAfterUncertainty).toBeLessThan(0.15);
  });

  it("finds the latest row on or before a date", () => {
    const series = prepareMarketSeries(makeCompoundRows({ years: 3, annualReturn: 0.05 }));

    expect(findLastRowIndexOnOrBefore(series.rows, "2021-06-01")).toBe(1);
    expect(findLastRowIndexOnOrBefore(series.rows, "2021-01-01")).toBe(1);
    expect(findLastRowIndexOnOrBefore(series.rows, "2019-12-31")).toBe(-1);
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

function makeTwoRateRows({
  years,
  changeYear,
  before,
  after,
}: {
  years: number;
  changeYear: number;
  before: number;
  after: number;
}): CanonicalMarketRow[] {
  const yearsBetween = (from: string, to: string) =>
    (new Date(`${to}T00:00:00.000Z`).getTime() -
      new Date(`${from}T00:00:00.000Z`).getTime()) /
    86_400_000 /
    365.2425;
  const changeDate = `${changeYear}-01-01`;
  return Array.from({ length: years + 1 }, (_, index) => {
    const date = `${2020 + index}-01-01`;
    const beforeYears = yearsBetween("2020-01-01", date < changeDate ? date : changeDate);
    const afterYears = date > changeDate ? yearsBetween(changeDate, date) : 0;
    return {
      date,
      total_return_index:
        100 *
        Math.exp(Math.log(1 + before) * beforeYears + Math.log(1 + after) * afterYears),
    };
  });
}
