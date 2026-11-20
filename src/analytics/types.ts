export type Frequency = "daily" | "weekly" | "monthly" | "irregular";

export type CanonicalMarketRow = {
  date: string;
  total_return_index: number;
  source_value?: number;
  provider?: string;
  symbol?: string;
  source_field?: string;
};

export type MarketObservation = CanonicalMarketRow & {
  dateObj: Date;
  yearsSinceStart: number;
  logIndex: number;
};

export type PreparedMarketSeries = {
  rows: MarketObservation[];
  frequency: Frequency;
  sampleYears: number;
  maxGapDays: number;
  unusualGapCount: number;
};

export type DeterministicTrendResult = {
  intercept: number;
  slope: number;
  annualizedTrendReturn: number;
  rSquared: number;
  residualSd: number;
  fitted: {
    date: string;
    yearsSinceStart: number;
    fittedLogTrend: number;
    trendIndex: number;
    residual: number;
    deviation: number;
  }[];
  latestTrendIndex: number;
  currentDeviation: number;
};

export type TrendReachDateResult = {
  targetIndex: number;
  date: string;
  yearsFromLatest: number;
};

export type BrokenTrendResult = {
  breakDate: string;
  breakIndex: number;
  slopeBefore: number;
  slopeAfter: number;
  annualizedReturnBefore: number;
  annualizedReturnAfter: number;
  yearsAfterBreak: number;
  /**
   * Rough one-standard-deviation error of `annualizedReturnAfter`, in the same
   * units (0.09 means about nine percentage points a year). It only reflects
   * how few years lie after the break.
   */
  annualizedReturnAfterUncertainty: number;
  fitted: {
    date: string;
    yearsSinceStart: number;
    trendIndex: number;
    deviation: number;
  }[];
  latestTrendIndex: number;
  currentDeviation: number;
};

export type RollingReturnPoint = {
  date: string;
  returns: Record<number, number | null>;
};
