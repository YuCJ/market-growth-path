import type { EChartsOption } from "echarts";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import {
  calculateRollingReturns,
  fitDeterministicTrend,
  fitRandomWalkWithDrift,
  generateForecast,
  generateRandomWalkBacktest,
  generateTrendExtension,
} from "./analytics/models";
import { addYears, elapsedYears, toIsoDate } from "./analytics/time";
import type { PreparedMarketSeries } from "./analytics/types";
import { Chart } from "./components/Chart";
import {
  canonicalDatasets,
  loadCanonicalDataset,
} from "./data/canonicalDatasets";

const FORECAST_YEARS = 30;
const DEFAULT_BACKTEST_LOOKBACK_MONTHS = 12;
const MIN_BACKTEST_LOOKBACK_MONTHS = 3;
const MAX_BACKTEST_LOOKBACK_MONTHS = 120;
const ROLLING_WINDOWS = [5, 10, 20];

type Analysis = {
  trend: ReturnType<typeof fitDeterministicTrend>;
  randomWalk: ReturnType<typeof fitRandomWalkWithDrift>;
  forecast: ReturnType<typeof generateForecast>;
  backtest: ReturnType<typeof generateRandomWalkBacktest>;
  trendExtension: ReturnType<typeof generateTrendExtension>;
  rollingReturns: ReturnType<typeof calculateRollingReturns>;
};

type ChartPoint = [string, number | null];

const DEFAULT_DATASET_ID = "market-total-return-iwda-lon-weekly-v1";

export default function App() {
  const [datasetId, setDatasetId] = useState(DEFAULT_DATASET_ID);
  const [yScale, setYScale] = useState<"log" | "value">("value");
  const [backtestLookbackMonths, setBacktestLookbackMonths] = useState(
    DEFAULT_BACKTEST_LOOKBACK_MONTHS,
  );
  const loaded = useMemo(
    () =>
      loadCanonicalDataset(
        canonicalDatasets.find((dataset) => dataset.id === datasetId) ??
          canonicalDatasets[0],
      ),
    [datasetId],
  );
  const backtestRange = useMemo(
    () => getBacktestLookbackRange(loaded.series),
    [loaded],
  );
  const selectedBacktestLookbackMonths = clamp(
    backtestLookbackMonths,
    backtestRange.min,
    backtestRange.max,
  );
  const analysis = useMemo(() => {
    const trend = fitDeterministicTrend(loaded.series);
    const randomWalk = fitRandomWalkWithDrift(loaded.series);
    return {
      trend,
      randomWalk,
      forecast: generateForecast(loaded.series, randomWalk, FORECAST_YEARS),
      backtest: generateRandomWalkBacktest(
        loaded.series,
        selectedBacktestLookbackMonths,
      ),
      trendExtension: generateTrendExtension(
        loaded.series,
        trend,
        FORECAST_YEARS,
      ),
      rollingReturns: calculateRollingReturns(loaded.series, ROLLING_WINDOWS),
    };
  }, [loaded, selectedBacktestLookbackMonths]);
  const latest = loaded.series.rows[loaded.series.rows.length - 1];
  const backtest = analysis.backtest;
  const backtestLabel = formatLookbackLabel(selectedBacktestLookbackMonths);
  const updateBacktestLookback = (value: string) =>
    setBacktestLookbackMonths(Number(value));
  const rSquaredValue = formatNumber(analysis.trend.rSquared, 3);
  const rSquaredPercent = formatPercent(analysis.trend.rSquared);
  const visibleDateRange = {
    min: toIsoDate(addYears(latest.dateObj, -5)),
    max: toIsoDate(addYears(latest.dateObj, 5)),
  };

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        {/* Page title and global dashboard controls */}
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-teal-700">
              Market Growth Path
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal text-slate-950">
              Long-term market growth dashboard
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Deterministic trend and random walk with drift views for the selected
              canonical market dataset.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="text-sm font-medium text-slate-700">
              <span className="mb-1 block">Dataset</span>
              <select
                className="h-10 min-w-64 rounded border border-slate-300 bg-white px-3 text-sm shadow-sm"
                value={datasetId}
                onChange={(event) => setDatasetId(event.target.value)}
              >
                {canonicalDatasets.map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>
                    {dataset.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="min-w-64 text-sm font-medium text-slate-700">
              <span className="mb-1 flex items-center justify-between gap-3">
                <span>Backtest lookback</span>
                <span className="font-semibold text-slate-950">
                  {formatLookbackDuration(selectedBacktestLookbackMonths)}
                </span>
              </span>
              <input
                aria-label="Backtest lookback months"
                className="h-10 w-full accent-teal-700"
                type="range"
                min={backtestRange.min}
                max={backtestRange.max}
                step={1}
                value={selectedBacktestLookbackMonths}
                onInput={(event) =>
                  updateBacktestLookback(event.currentTarget.value)
                }
                onChange={(event) =>
                  updateBacktestLookback(event.currentTarget.value)
                }
              />
              <span className="flex justify-between text-xs text-slate-500">
                <span>{formatLookbackDuration(backtestRange.min)}</span>
                <span>{formatLookbackDuration(backtestRange.max)}</span>
              </span>
            </div>

            <label className="text-sm font-medium text-slate-700">
              <span className="mb-1 block">Y axis</span>
              <select
                className="h-10 rounded border border-slate-300 bg-white px-3 text-sm shadow-sm"
                value={yScale}
                onChange={(event) => setYScale(event.target.value as "log" | "value")}
              >
                <option value="log">Log</option>
                <option value="value">Linear</option>
              </select>
            </label>
          </div>
        </header>

        {/* Primary growth path chart */}
        <section className="py-5">
          <Panel title="Index, trend, and forecast paths">
            <Chart
              option={buildMainChart(
                loaded,
                analysis,
                yScale,
                visibleDateRange,
                backtestLabel,
              )}
              height={460}
            />
          </Panel>
        </section>

        {/* Plain-language model explanations */}
        <section className="grid gap-4 pb-5 text-sm leading-6 text-slate-700 lg:grid-cols-3">
          <Explanation
            title="Model A"
            body="Assumes the historical log index moves around one smooth long-term time trend. The line is fitted with the full history, so it does not need to pass through today's index."
            translation="假設歷史指數的對數水準，圍繞一條平滑的長期時間趨勢。這條線用整段歷史資料估計，所以不一定會通過今天的指數。"
          />
          <Explanation
            title="Model B"
            body="Assumes log returns have a long-run average drift, while market shocks permanently change the index level. The expected future path starts from the latest actual index."
            translation="假設報酬有一個長期平均成長率，而市場衝擊會永久改變指數水準。未來期望路徑會從最新實際指數開始。"
          />
          <Explanation
            title="R-squared"
            body={`R-squared is ${rSquaredValue}, which means Model A's smooth trend line explains about ${rSquaredPercent} of the historical log-index variation. It is not a win rate or forecast accuracy.`}
            translation={`現在的 R-squared 是 ${rSquaredValue}，可以粗略讀成：模型 A 的平滑趨勢線能解釋約 ${rSquaredPercent} 的歷史指數變化。數字越接近 1，代表歷史走勢越貼近這條線；但這不是勝率，也不是預測準確率。`}
          />
        </section>

        {/* Key model and dataset metrics */}
        <section className="grid gap-3 pb-5 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Latest index" value={formatNumber(latest.total_return_index)} />
          <Metric
            label="Model A trend return"
            value={formatPercent(analysis.trend.annualizedTrendReturn)}
          />
          <Metric
            label="Model B drift return"
            value={formatPercent(analysis.randomWalk.annualizedDriftReturn)}
          />
          <Metric
            label="Current trend deviation"
            value={formatPercent(analysis.trend.currentDeviation)}
          />
          <Metric label="Sample years" value={formatNumber(loaded.series.sampleYears, 1)} />
          <Metric label="Frequency" value={loaded.series.frequency} />
          <Metric label="Data points" value={formatNumber(loaded.series.rows.length, 0)} />
          <Metric label="R-squared" value={formatNumber(analysis.trend.rSquared, 3)} />
          <Metric
            label={`${backtestLabel} expected today`}
            value={
              backtest
                ? formatNumber(backtest.expectedLatest)
                : "n/a"
            }
          />
          <Metric
            label={`${backtestLabel} forecast gap`}
            value={backtest ? formatPercent(backtest.gap) : "n/a"}
          />
          <Metric
            label={`${backtestLabel} backtest band`}
            value={
              backtest
                ? formatBacktestBand(backtest.inside80, backtest.inside95)
                : "n/a"
            }
          />
          <Metric
            label={`${backtestLabel} origin date`}
            value={backtest?.originDate ?? "n/a"}
          />
        </section>

        {/* Selected canonical dataset metadata */}
        <section className="mb-5 grid gap-3 border-y border-slate-200 py-4 text-sm text-slate-700 lg:grid-cols-4">
          <Info label="Provider" value={loaded.metadata.provider} />
          <Info label="Symbol" value={loaded.metadata.symbol} />
          <Info label="Source field" value={loaded.metadata.sourceField} />
          <Info
            label="Date range"
            value={`${loaded.metadata.startDate} to ${loaded.metadata.endDate}`}
          />
          <Info label="Dataset" value={loaded.dataset.description} wide />
          <Info
            label="Gap diagnostics"
            value={`Max ${loaded.series.maxGapDays} days, ${loaded.series.unusualGapCount} unusual gaps`}
            wide
          />
        </section>

        {/* Secondary analysis charts */}
        <section className="grid gap-5">
          <div className="grid gap-5 xl:grid-cols-2">
            <Panel title="Deviation from deterministic trend">
              <Chart option={buildDeviationChart(analysis, visibleDateRange)} />
            </Panel>
            <Panel title="Log returns and rolling annualized returns">
              <Chart option={buildReturnsChart(loaded, analysis, visibleDateRange)} />
            </Panel>
          </div>
        </section>

      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-950">{value}</div>
    </div>
  );
}

function Info({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "lg:col-span-2" : ""}>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-slate-900">{value}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold text-slate-950">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Explanation({
  title,
  body,
  translation,
}: {
  title: string;
  body: string;
  translation: string;
}) {
  return (
    <div className="rounded border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="font-semibold text-slate-950">{title}</h3>
      <p className="mt-2 text-slate-800">{translation}</p>
      <p className="mt-2 text-slate-500">{body}</p>
    </div>
  );
}

function buildMainChart(
  loaded: ReturnType<typeof loadCanonicalDataset>,
  analysis: Analysis,
  yScale: "log" | "value",
  visibleDateRange: VisibleDateRange,
  backtestLabel: string,
): EChartsOption {
  const historical: ChartPoint[] = loaded.series.rows.map((row) => [
    row.date,
    row.total_return_index,
  ]);
  const fitted: ChartPoint[] = analysis.trend.fitted.map((point) => [
    point.date,
    point.trendIndex,
  ]);
  const trendExtension: ChartPoint[] = analysis.trendExtension.map((point) => [
    point.date,
    point.trendIndex,
  ]);
  const forecast: ChartPoint[] = analysis.forecast.map((point) => [
    point.date,
    point.expected,
  ]);
  const backtestForecast: ChartPoint[] =
    analysis.backtest?.path.map((point) => [
      point.date,
      point.expected,
    ]) ?? [];
  const backtestPathLabel = `Model B ${backtestLabel} backtest path`;
  const visiblePrimaryLines = [
    ...filterVisibleData(historical, visibleDateRange),
    ...filterVisibleData(fitted, visibleDateRange),
    ...filterVisibleData(trendExtension, visibleDateRange),
    ...filterVisibleData(forecast, visibleDateRange),
    ...filterVisibleData(backtestForecast, visibleDateRange),
  ];

  return baseChartOption({
    yScale,
    yRange: paddedYRange(visiblePrimaryLines, yScale),
    visibleDateRange,
    legend: [
      "Actual index",
      "Model A fitted trend",
      "Model A extension",
      "Model B expected path",
      backtestPathLabel,
    ],
    series: [
      line("Actual index", filterVisibleData(historical, visibleDateRange), "#0f766e", 2.4),
      line("Model A fitted trend", filterVisibleData(fitted, visibleDateRange), "#2563eb", 2),
      line(
        "Model A extension",
        filterVisibleData(trendExtension, visibleDateRange),
        "#60a5fa",
        2,
        "dashed",
      ),
      line(
        "Model B expected path",
        filterVisibleData(forecast, visibleDateRange),
        "#b45309",
        2.4,
      ),
      line(
        backtestPathLabel,
        filterVisibleData(backtestForecast, visibleDateRange),
        "#e11d48",
        2.2,
        "dotted",
      ),
    ],
  });
}

function buildDeviationChart(
  analysis: Analysis,
  visibleDateRange: VisibleDateRange,
): EChartsOption {
  return baseChartOption({
    yScale: "value",
    visibleDateRange,
    yFormatter: (value) => `${formatNumber(Number(value) * 100, 0)}%`,
    legend: ["Deviation"],
    series: [
      line(
        "Deviation",
        filterVisibleData(
          analysis.trend.fitted.map((point) => [point.date, point.deviation]),
          visibleDateRange,
        ),
        "#7c3aed",
        2,
      ),
    ],
  });
}

function buildReturnsChart(
  loaded: ReturnType<typeof loadCanonicalDataset>,
  analysis: Analysis,
  visibleDateRange: VisibleDateRange,
): EChartsOption {
  const logReturns: ChartPoint[] = loaded.series.rows.slice(1).map((row, index) => [
    row.date,
    row.logIndex - loaded.series.rows[index].logIndex,
  ]);
  const rollingSeries = ROLLING_WINDOWS.map((windowYears) =>
    line(
      `${windowYears}Y rolling`,
      filterVisibleData(
        analysis.rollingReturns
          .map((point) => [point.date, point.returns[windowYears]])
          .filter(([, value]) => value !== null) as [string, number][],
        visibleDateRange,
      ),
      rollingColor(windowYears),
      2,
    ),
  );

  return baseChartOption({
    yScale: "value",
    visibleDateRange,
    yFormatter: (value) => `${formatNumber(Number(value) * 100, 0)}%`,
    legend: ["Log return", ...ROLLING_WINDOWS.map((years) => `${years}Y rolling`)],
    series: [
      {
        ...line("Log return", logReturns, "#64748b", 1),
        data: filterVisibleData(logReturns, visibleDateRange),
        type: "bar",
      },
      ...rollingSeries,
    ],
  });
}

function baseChartOption({
  yScale,
  yRange,
  visibleDateRange,
  legend,
  series,
  yFormatter,
}: {
  yScale: "log" | "value";
  yRange?: { min: number; max: number };
  visibleDateRange: VisibleDateRange;
  legend: string[];
  series: EChartsOption["series"];
  yFormatter?: (value: string | number) => string;
}): EChartsOption {
  return {
    animation: false,
    color: ["#0f766e", "#2563eb", "#b45309", "#7c3aed", "#64748b"],
    tooltip: {
      trigger: "axis",
      valueFormatter: (value) =>
        typeof value === "number" ? formatNumber(value, 2) : String(value),
    },
    legend: {
      data: legend,
      type: "scroll",
      top: 0,
      textStyle: { color: "#475569" },
    },
    grid: { left: 58, right: 24, top: 56, bottom: 36 },
    xAxis: {
      type: "time",
      min: visibleDateRange.min,
      max: visibleDateRange.max,
      axisLine: { lineStyle: { color: "#cbd5e1" } },
      axisLabel: { color: "#64748b" },
    },
    yAxis: {
      type: yScale,
      min: yRange?.min,
      max: yRange?.max,
      axisLine: { lineStyle: { color: "#cbd5e1" } },
      axisLabel: {
        color: "#64748b",
        formatter:
          yFormatter ?? ((value) => formatNumber(Number(value), 0)),
      },
      splitLine: { lineStyle: { color: "#e2e8f0" } },
    },
    series,
  };
}

type VisibleDateRange = {
  min: string;
  max: string;
};

function line(
  name: string,
  data: (string | number | null)[][],
  color: string,
  width: number,
  type: "solid" | "dashed" | "dotted" = "solid",
) {
  return {
    name,
    type: "line" as const,
    data,
    showSymbol: false,
    smooth: false,
    lineStyle: { color, width, type },
    itemStyle: { color },
  };
}

function filterVisibleData<T extends ChartPoint>(
  data: T[],
  visibleDateRange: VisibleDateRange,
): T[] {
  return data.filter(
    ([date]) => date >= visibleDateRange.min && date <= visibleDateRange.max,
  );
}

function paddedYRange(
  data: ChartPoint[],
  yScale: "log" | "value",
): { min: number; max: number } | undefined {
  const values = data
    .map(([, value]) => value)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  if (values.length === 0) {
    return undefined;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  if (yScale === "log") {
    return {
      min: Math.max(min / 1.12, 0.000001),
      max: max * 1.12,
    };
  }

  const range = max - min || max || 1;
  return {
    min: Math.max(min - range * 0.12, 0),
    max: max + range * 0.12,
  };
}

function rollingColor(windowYears: number): string {
  if (windowYears === 5) {
    return "#0f766e";
  }
  if (windowYears === 10) {
    return "#2563eb";
  }
  return "#b45309";
}

function getBacktestLookbackRange(
  series: PreparedMarketSeries,
): { min: number; max: number } {
  const latest = series.rows[series.rows.length - 1];
  const earliestOrigin = series.rows[1] ?? series.rows[0];
  const availableMonths = Math.max(
    1,
    Math.floor(elapsedYears(earliestOrigin.dateObj, latest.dateObj) * 12),
  );
  const max = Math.max(
    1,
    Math.min(MAX_BACKTEST_LOOKBACK_MONTHS, availableMonths),
  );
  const min = Math.min(MIN_BACKTEST_LOOKBACK_MONTHS, max);

  return { min, max };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function formatLookbackLabel(months: number): string {
  if (months % 12 === 0) {
    return `${months / 12}Y`;
  }
  return `${months}M`;
}

function formatLookbackDuration(months: number): string {
  if (months % 12 === 0) {
    const years = months / 12;
    return years === 1 ? "1 year" : `${years} years`;
  }
  return months === 1 ? "1 month" : `${months} months`;
}

function formatPercent(value: number): string {
  return `${formatNumber(value * 100, 2)}%`;
}

function formatBacktestBand(inside80: boolean, inside95: boolean): string {
  if (inside80) {
    return "Inside 80%";
  }
  if (inside95) {
    return "Inside 95%";
  }
  return "Outside 95%";
}

function formatNumber(value: number, digits = 2): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}
