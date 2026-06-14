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

export type RandomWalkDriftResult = {
  mu: number;
  annualizedDriftReturn: number;
  annualizedInnovationSd: number;
  residuals: {
    date: string;
    deltaYears: number;
    logReturn: number;
    residual: number;
  }[];
};

export type ForecastPoint = {
  date: string;
  hYears: number;
  expected: number;
  lower80: number;
  upper80: number;
  lower95: number;
  upper95: number;
};

export type RollingReturnPoint = {
  date: string;
  returns: Record<number, number | null>;
};
