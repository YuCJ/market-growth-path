export type MarketDataProviderId = "alpha-vantage";

export type MarketDataRequest = {
  symbol: string;
};

export type SourceMarketRow = {
  date: string;
  provider: MarketDataProviderId;
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjusted_close: number;
  volume: number;
  dividend_amount: number;
};

export type MarketDataProvider = {
  id: MarketDataProviderId;
  fetchWeeklyAdjustedSeries: (
    request: MarketDataRequest,
  ) => Promise<SourceMarketRow[]>;
};

