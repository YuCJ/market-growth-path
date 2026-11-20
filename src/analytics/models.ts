import {
  DAYS_PER_YEAR,
  addStep,
  addYears,
  elapsedYears,
  toIsoDate,
} from "./time";
import type {
  BrokenTrendResult,
  DeterministicTrendResult,
  PreparedMarketSeries,
  RollingReturnPoint,
  TrendReachDateResult,
} from "./types";

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

/**
 * Fits one trend line that is allowed to change its growth rate once, on
 * `breakDate`: ln(V) = a + b * t + d * max(0, t - breakTime).
 *
 * The two straight pieces meet at the break, so the line bends there but does
 * not jump. This is the "changing growth" trend of Perron (1989). All three
 * numbers are estimated together by least squares on the whole history.
 *
 * Returns null when either side of the break has fewer than three rows, because
 * a growth rate cannot be read from one or two points.
 */
export function fitBrokenTrend(
  series: PreparedMarketSeries,
  breakDate: string,
): BrokenTrendResult | null {
  const rows = series.rows;
  const breakIndex = findLastRowIndexOnOrBefore(rows, breakDate);
  if (breakIndex < 2 || breakIndex > rows.length - 4) {
    return null;
  }

  const breakYears = rows[breakIndex].yearsSinceStart;
  // Time is measured from the break so that the intercept is the trend level
  // on the break date and the sums below stay small.
  const design = rows.map((row) => {
    const sinceBreak = row.yearsSinceStart - breakYears;
    return [1, sinceBreak, Math.max(0, sinceBreak)];
  });
  const coefficients = solveLeastSquares(
    design,
    rows.map((row) => row.logIndex),
  );
  if (coefficients === null) {
    return null;
  }

  const [levelAtBreak, slopeBefore, slopeChange] = coefficients;
  const slopeAfter = slopeBefore + slopeChange;
  const logTrendAt = (yearsSinceStart: number) =>
    levelAtBreak +
    slopeBefore * (yearsSinceStart - breakYears) +
    slopeChange * Math.max(0, yearsSinceStart - breakYears);
  const fitted = rows.map((row) => {
    const trendIndex = Math.exp(logTrendAt(row.yearsSinceStart));
    return {
      date: row.date,
      yearsSinceStart: row.yearsSinceStart,
      trendIndex,
      deviation: row.total_return_index / trendIndex - 1,
    };
  });
  const latest = rows[rows.length - 1];
  const yearsAfterBreak = latest.yearsSinceStart - breakYears;
  const latestTrendIndex = fitted[fitted.length - 1].trendIndex;

  return {
    breakDate: rows[breakIndex].date,
    breakIndex,
    slopeBefore,
    slopeAfter,
    annualizedReturnBefore: Math.exp(slopeBefore) - 1,
    annualizedReturnAfter: Math.exp(slopeAfter) - 1,
    yearsAfterBreak,
    // The average yearly growth over N years of returns with yearly volatility
    // s is known only to about s / sqrt(N) (Merton 1980). More frequent data
    // does not shrink this; only more years do. Multiplying by exp(slopeAfter)
    // turns the error of the log growth rate into the error of the yearly
    // return that the page displays.
    annualizedReturnAfterUncertainty:
      (Math.exp(slopeAfter) * annualizedVolatility(rows)) /
      Math.sqrt(yearsAfterBreak),
    fitted,
    latestTrendIndex,
    currentDeviation: latest.total_return_index / latestTrendIndex - 1,
  };
}

/** Standard deviation of log returns, scaled to one year of elapsed time. */
function annualizedVolatility(rows: PreparedMarketSeries["rows"]): number {
  const last = rows.length - 1;
  const totalYears = rows[last].yearsSinceStart - rows[0].yearsSinceStart;
  const meanGrowth = (rows[last].logIndex - rows[0].logIndex) / totalYears;
  let sum = 0;
  for (let index = 1; index <= last; index += 1) {
    const deltaYears =
      rows[index].yearsSinceStart - rows[index - 1].yearsSinceStart;
    const surprise =
      rows[index].logIndex - rows[index - 1].logIndex - meanGrowth * deltaYears;
    sum += surprise ** 2 / deltaYears;
  }
  return Math.sqrt(sum / Math.max(last - 1, 1));
}

/**
 * Least-squares coefficients for `design * coefficients ~ values`, or null when
 * the columns of `design` do not carry independent information.
 */
function solveLeastSquares(
  design: number[][],
  values: number[],
): number[] | null {
  const size = design[0].length;
  // Normal equations (X'X) c = X'y, with X'y kept as an extra column.
  const system = Array.from({ length: size }, (_, row) =>
    Array.from({ length: size + 1 }, (_, column) =>
      design.reduce(
        (total, line, index) =>
          total +
          line[row] * (column < size ? line[column] : values[index]),
        0,
      ),
    ),
  );

  for (let pivot = 0; pivot < size; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < size; row += 1) {
      if (Math.abs(system[row][pivot]) > Math.abs(system[best][pivot])) {
        best = row;
      }
    }
    if (Math.abs(system[best][pivot]) < 1e-12) {
      return null;
    }
    [system[pivot], system[best]] = [system[best], system[pivot]];
    for (let row = 0; row < size; row += 1) {
      if (row === pivot) {
        continue;
      }
      const factor = system[row][pivot] / system[pivot][pivot];
      for (let column = pivot; column <= size; column += 1) {
        system[row][column] -= factor * system[pivot][column];
      }
    }
  }

  return system.map((line, index) => line[size] / line[index]);
}

/**
 * Index of the latest row dated on or before `date`, searching backwards from
 * `fromIndex`. Returns -1 when every row searched is later than `date`.
 */
export function findLastRowIndexOnOrBefore(
  rows: PreparedMarketSeries["rows"],
  date: string,
  fromIndex = rows.length - 1,
): number {
  for (let index = fromIndex; index >= 0; index -= 1) {
    if (rows[index].date <= date) {
      return index;
    }
  }
  return -1;
}

export function generateTrendExtension(
  series: PreparedMarketSeries,
  trend: DeterministicTrendResult,
  years: number,
): { date: string; trendIndex: number }[] {
  return extendTrend(series, years, (yearsSinceStart) =>
    Math.exp(trend.intercept + trend.slope * yearsSinceStart),
  );
}

/** Continues the after-break piece of the broken trend into the future. */
export function generateBrokenTrendExtension(
  series: PreparedMarketSeries,
  trend: BrokenTrendResult,
  years: number,
): { date: string; trendIndex: number }[] {
  const latest = series.rows[series.rows.length - 1];
  return extendTrend(series, years, (yearsSinceStart) =>
    trend.latestTrendIndex *
    Math.exp(trend.slopeAfter * (yearsSinceStart - latest.yearsSinceStart)),
  );
}

function extendTrend(
  series: PreparedMarketSeries,
  years: number,
  trendIndexAt: (yearsSinceStart: number) => number,
): { date: string; trendIndex: number }[] {
  const latest = series.rows[series.rows.length - 1];
  const endDate = addYears(latest.dateObj, years);
  const points: { date: string; trendIndex: number }[] = [];
  let date = latest.dateObj;

  while (date <= endDate) {
    points.push({
      date: toIsoDate(date),
      trendIndex: trendIndexAt(elapsedYears(series.rows[0].dateObj, date)),
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
