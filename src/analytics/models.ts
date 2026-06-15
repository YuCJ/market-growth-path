import {
  DAYS_PER_YEAR,
  addMonths,
  addStep,
  addYears,
  elapsedYears,
  toIsoDate,
} from "./time";
import type {
  DeterministicTrendResult,
  ForecastPoint,
  PreparedMarketSeries,
  RandomWalkBacktestResult,
  RandomWalkDriftResult,
  RollingReturnPoint,
  TrendReachDateResult,
} from "./types";

const Z80 = 1.2816;
const Z95 = 1.96;
const MIN_FUTURE_REACH_YEARS = 1 / DAYS_PER_YEAR;

export function fitDeterministicTrend(
  series: PreparedMarketSeries,
): DeterministicTrendResult {
  const rows = series.rows;
  const xMean = mean(rows.map((row) => row.yearsSinceStart));
  const yMean = mean(rows.map((row) => row.logIndex));
  const xVariance = rows.reduce(
    (total, row) => total + (row.yearsSinceStart - xMean) ** 2,
    0,
  );

  if (xVariance === 0) {
    throw new Error("Cannot fit deterministic trend without elapsed time.");
  }

  const covariance = rows.reduce(
    (total, row) =>
      total + (row.yearsSinceStart - xMean) * (row.logIndex - yMean),
    0,
  );
  const slope = covariance / xVariance;
  const intercept = yMean - slope * xMean;
  const fitted = rows.map((row) => {
    const fittedLogTrend = intercept + slope * row.yearsSinceStart;
    const trendIndex = Math.exp(fittedLogTrend);
    return {
      date: row.date,
      yearsSinceStart: row.yearsSinceStart,
      fittedLogTrend,
      trendIndex,
      residual: row.logIndex - fittedLogTrend,
      deviation: row.total_return_index / trendIndex - 1,
    };
  });
  const residualSumSquares = fitted.reduce(
    (total, point) => total + point.residual ** 2,
    0,
  );
  const totalSumSquares = rows.reduce(
    (total, row) => total + (row.logIndex - yMean) ** 2,
    0,
  );
  const latestTrendIndex = fitted[fitted.length - 1].trendIndex;
  const latestActualIndex = rows[rows.length - 1].total_return_index;

  return {
    intercept,
    slope,
    annualizedTrendReturn: Math.exp(slope) - 1,
    rSquared: totalSumSquares === 0 ? 1 : 1 - residualSumSquares / totalSumSquares,
    residualSd: Math.sqrt(residualSumSquares / Math.max(rows.length - 2, 1)),
    fitted,
    latestTrendIndex,
    currentDeviation: latestActualIndex / latestTrendIndex - 1,
  };
}

export function fitRandomWalkWithDrift(
  series: PreparedMarketSeries,
): RandomWalkDriftResult {
  return fitRandomWalkRows(series.rows);
}

function fitRandomWalkRows(
  rows: PreparedMarketSeries["rows"],
): RandomWalkDriftResult {
  const logReturns = rows.slice(1).map((row, index) => ({
    date: row.date,
    deltaYears: elapsedYears(rows[index].dateObj, row.dateObj),
    logReturn: row.logIndex - rows[index].logIndex,
  }));
  const totalLogReturn = logReturns.reduce((total, row) => total + row.logReturn, 0);
  const totalYears = logReturns.reduce((total, row) => total + row.deltaYears, 0);
  const mu = totalLogReturn / totalYears;
  const residuals = logReturns.map((row) => ({
    ...row,
    residual: row.logReturn - mu * row.deltaYears,
  }));
  const annualizedVariance =
    residuals.reduce(
      (total, row) => total + row.residual ** 2 / row.deltaYears,
      0,
    ) / Math.max(residuals.length - 1, 1);

  return {
    mu,
    annualizedDriftReturn: Math.exp(mu) - 1,
    annualizedInnovationSd: Math.sqrt(annualizedVariance),
    residuals,
  };
}

export function generateForecast(
  series: PreparedMarketSeries,
  randomWalk: RandomWalkDriftResult,
  years: number,
): ForecastPoint[] {
  const latest = series.rows[series.rows.length - 1];
  const endDate = addYears(latest.dateObj, years);
  const points: ForecastPoint[] = [];
  let date = latest.dateObj;

  while (date <= endDate) {
    const hYears = elapsedYears(latest.dateObj, date);
    points.push(
      forecastPoint({
        date: toIsoDate(date),
        hYears,
        originLogIndex: latest.logIndex,
        randomWalk,
        sampleYears: series.sampleYears,
      }),
    );
    date = addStep(date, series.frequency);
  }

  return points;
}

export function generateRandomWalkBacktest(
  series: PreparedMarketSeries,
  lookbackMonths: number,
): RandomWalkBacktestResult | null {
  const rows = series.rows;
  const latest = rows[rows.length - 1];
  const originIndex = findBacktestOriginIndex(rows, latest, lookbackMonths);
  if (originIndex === null || originIndex < 1) {
    return null;
  }

  const origin = rows[originIndex];
  const trainingRows = rows.slice(0, originIndex + 1);
  const randomWalkAtOrigin = fitRandomWalkRows(trainingRows);
  const sampleYearsAtOrigin = elapsedYears(trainingRows[0].dateObj, origin.dateObj);
  const path = rows.slice(originIndex).map((row) =>
    forecastPoint({
      date: row.date,
      hYears: elapsedYears(origin.dateObj, row.dateObj),
      originLogIndex: origin.logIndex,
      randomWalk: randomWalkAtOrigin,
      sampleYears: sampleYearsAtOrigin,
    }),
  );
  const latestPoint = path[path.length - 1];
  const forecastSd =
    randomWalkAtOrigin.annualizedInnovationSd *
    Math.sqrt(
      latestPoint.hYears + latestPoint.hYears ** 2 / sampleYearsAtOrigin,
    );
  const zScore =
    forecastSd === 0
      ? null
      : (latest.logIndex - Math.log(latestPoint.expected)) / forecastSd;

  return {
    lookbackMonths,
    originDate: origin.date,
    latestDate: latest.date,
    originIndex,
    actualLatest: latest.total_return_index,
    expectedLatest: latestPoint.expected,
    gap: latest.total_return_index / latestPoint.expected - 1,
    zScore,
    inside80:
      latest.total_return_index >= latestPoint.lower80 &&
      latest.total_return_index <= latestPoint.upper80,
    inside95:
      latest.total_return_index >= latestPoint.lower95 &&
      latest.total_return_index <= latestPoint.upper95,
    annualizedDriftReturnAtOrigin: randomWalkAtOrigin.annualizedDriftReturn,
    path,
  };
}

function forecastPoint({
  date,
  hYears,
  originLogIndex,
  randomWalk,
  sampleYears,
}: {
  date: string;
  hYears: number;
  originLogIndex: number;
  randomWalk: RandomWalkDriftResult;
  sampleYears: number;
}): ForecastPoint {
  const expectedLog = originLogIndex + randomWalk.mu * hYears;
  const forecastSd =
    randomWalk.annualizedInnovationSd *
    Math.sqrt(hYears + hYears ** 2 / sampleYears);

  return {
    date,
    hYears,
    expected: Math.exp(expectedLog),
    lower80: Math.exp(expectedLog - Z80 * forecastSd),
    upper80: Math.exp(expectedLog + Z80 * forecastSd),
    lower95: Math.exp(expectedLog - Z95 * forecastSd),
    upper95: Math.exp(expectedLog + Z95 * forecastSd),
  };
}

function findBacktestOriginIndex(
  rows: PreparedMarketSeries["rows"],
  latest: PreparedMarketSeries["rows"][number],
  lookbackMonths: number,
): number | null {
  const targetDate = addMonths(latest.dateObj, -lookbackMonths);
  for (let index = rows.length - 2; index >= 0; index -= 1) {
    if (rows[index].dateObj <= targetDate) {
      return index;
    }
  }
  return null;
}

export function generateTrendExtension(
  series: PreparedMarketSeries,
  trend: DeterministicTrendResult,
  years: number,
): { date: string; trendIndex: number }[] {
  const latest = series.rows[series.rows.length - 1];
  const endDate = addYears(latest.dateObj, years);
  const points: { date: string; trendIndex: number }[] = [];
  let date = latest.dateObj;

  while (date <= endDate) {
    const yearsSinceStart = elapsedYears(series.rows[0].dateObj, date);
    points.push({
      date: toIsoDate(date),
      trendIndex: Math.exp(trend.intercept + trend.slope * yearsSinceStart),
    });
    date = addStep(date, series.frequency);
  }

  return points;
}

export function estimateTrendReachDate(
  series: PreparedMarketSeries,
  trend: DeterministicTrendResult,
  targetIndex: number,
): TrendReachDateResult | null {
  if (targetIndex <= 0 || trend.slope <= 0) {
    return null;
  }

  const latest = series.rows[series.rows.length - 1];
  const targetYearsSinceStart = (Math.log(targetIndex) - trend.intercept) / trend.slope;
  const yearsFromLatest = targetYearsSinceStart - latest.yearsSinceStart;
  if (yearsFromLatest < MIN_FUTURE_REACH_YEARS) {
    return null;
  }

  const firstDate = series.rows[0].dateObj;
  const targetTime =
    firstDate.getTime() + targetYearsSinceStart * DAYS_PER_YEAR * 86_400_000;

  return {
    targetIndex,
    date: toIsoDate(new Date(targetTime)),
    yearsFromLatest,
  };
}

export function calculateRollingReturns(
  series: PreparedMarketSeries,
  windows: number[],
): RollingReturnPoint[] {
  const rows = series.rows;
  return rows.map((row, index) => ({
    date: row.date,
    returns: Object.fromEntries(
      windows.map((windowYears) => {
        const start = findRollingStart(rows, index, windowYears);
        if (!start) {
          return [windowYears, null];
        }
        const years = elapsedYears(start.dateObj, row.dateObj);
        return [
          windowYears,
          Math.exp((row.logIndex - start.logIndex) / years) - 1,
        ];
      }),
    ),
  }));
}

function findRollingStart(
  rows: PreparedMarketSeries["rows"],
  endIndex: number,
  windowYears: number,
) {
  const end = rows[endIndex];
  for (let index = endIndex - 1; index >= 0; index -= 1) {
    const years = elapsedYears(rows[index].dateObj, end.dateObj);
    if (years >= windowYears) {
      return rows[index];
    }
  }
  return null;
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}
