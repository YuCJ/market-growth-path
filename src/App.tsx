import type { EChartsOption } from "echarts";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import {
  calculateRollingReturns,
  fitDeterministicTrend,
  fitRandomWalkWithDrift,
  estimateTrendReachDate,
  findLastRowIndexOnOrBefore,
  generateForecast,
  generateRandomWalkBacktest,
  generateTrendExtension,
} from "./analytics/models";
import { addMonths, addYears, elapsedYears, toIsoDate } from "./analytics/time";
import type { PreparedMarketSeries } from "./analytics/types";
import { Chart } from "./components/Chart";
import {
  canonicalDatasets,
  loadCanonicalDataset,
} from "./data/canonicalDatasets";

const FORECAST_YEARS = 30;
// ChatGPT became public on 2022-11-30. The default comparison starts at the
// last data point on or before that day, so the Model B gap reads as "how far
// the index has moved beyond average growth since generative AI arrived".
const DEFAULT_COMPARISON_START_DATE = "2022-11-30";
// Closer than this to the latest date, the gap is mostly a few weeks of noise.
const MIN_COMPARISON_MONTHS_BACK = 3;
// The main chart widens to include the start date, so this also caps how far
// the chart can be stretched. It does not check how much earlier history is
// left for estimating the average growth rate.
const MAX_COMPARISON_MONTHS_BACK = 120;
const ROLLING_WINDOWS = [5, 10, 20];
const ACTUAL_COLOR = "#0f766e";
const MODEL_A_COLOR = "#2563eb";
const MODEL_B_START_COLOR = "#e11d48";

type Analysis = {
  trend: ReturnType<typeof fitDeterministicTrend>;
  randomWalk: ReturnType<typeof fitRandomWalkWithDrift>;
  forecast: ReturnType<typeof generateForecast>;
  backtest: ReturnType<typeof generateRandomWalkBacktest>;
  trendExtension: ReturnType<typeof generateTrendExtension>;
  trendReachLatestIndex: ReturnType<typeof estimateTrendReachDate>;
  rollingReturns: ReturnType<typeof calculateRollingReturns>;
};

type ChartPoint = [string, number | null];

const DEFAULT_DATASET_ID = "market-total-return-iwda-lon-weekly-v1";

export default function App() {
  const [datasetId, setDatasetId] = useState(DEFAULT_DATASET_ID);
  const [yScale, setYScale] = useState<"log" | "value">("value");
  const [comparisonStartDate, setComparisonStartDate] = useState(
    DEFAULT_COMPARISON_START_DATE,
  );
  const loaded = useMemo(
    () =>
      loadCanonicalDataset(
        canonicalDatasets.find((dataset) => dataset.id === datasetId) ??
          canonicalDatasets[0],
      ),
    [datasetId],
  );
  const rows = loaded.series.rows;
  const startRange = useMemo(
    () => getComparisonStartRange(loaded.series),
    [loaded],
  );
  // The chosen date is kept as a calendar date, so it stays on the same event
  // when the dataset changes or new weekly data arrives. Each dataset then
  // maps it to its own nearest earlier row.
  const selectedStartIndex = clamp(
    findLastRowIndexOnOrBefore(rows, comparisonStartDate),
    startRange.minIndex,
    startRange.maxIndex,
  );
  const selectedStartDate = rows[selectedStartIndex].date;
  const analysis = useMemo(() => {
    const trend = fitDeterministicTrend(loaded.series);
    const randomWalk = fitRandomWalkWithDrift(loaded.series);
    return {
      trend,
      randomWalk,
      forecast: generateForecast(loaded.series, randomWalk, FORECAST_YEARS),
      backtest: generateRandomWalkBacktest(loaded.series, selectedStartDate),
      trendExtension: generateTrendExtension(
        loaded.series,
        trend,
        FORECAST_YEARS,
      ),
      trendReachLatestIndex: estimateTrendReachDate(
        loaded.series,
        trend,
        loaded.series.rows[loaded.series.rows.length - 1].total_return_index,
      ),
      rollingReturns: calculateRollingReturns(loaded.series, ROLLING_WINDOWS),
    };
  }, [loaded, selectedStartDate]);
  const latest = loaded.series.rows[loaded.series.rows.length - 1];
  const backtest = analysis.backtest;
  const backtestStartIndex = backtest
    ? loaded.series.rows[backtest.originIndex].total_return_index
    : null;
  const updateComparisonStart = (rowIndex: string) =>
    setComparisonStartDate(rows[Number(rowIndex)].date);
  const rSquaredValue = formatNumber(analysis.trend.rSquared, 3);
  const rSquaredPercent = formatPercent(analysis.trend.rSquared);
  const defaultVisibleStart = toIsoDate(addYears(latest.dateObj, -5));
  const visibleDateRange = {
    // A Model B start date more than five years back would otherwise sit
    // outside the chart, leaving a dotted line with no visible beginning.
    min:
      backtest && backtest.originDate < defaultVisibleStart
        ? backtest.originDate
        : defaultVisibleStart,
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
              <span className="mb-1 flex flex-col">
                <span>Compare with average growth since</span>
                <span className="font-semibold text-slate-950">
                  {`${selectedStartDate} (${formatNumber(
                    elapsedYears(rows[selectedStartIndex].dateObj, latest.dateObj),
                    1,
                  )} years ago)`}
                </span>
              </span>
              <input
                aria-label="Comparison start date"
                className="h-10 w-full accent-teal-700"
                type="range"
                min={startRange.minIndex}
                max={startRange.maxIndex}
                step={1}
                value={selectedStartIndex}
                onInput={(event) =>
                  updateComparisonStart(event.currentTarget.value)
                }
                onChange={(event) =>
                  updateComparisonStart(event.currentTarget.value)
                }
              />
              <span className="flex justify-between text-xs text-slate-500">
                <span>{rows[startRange.minIndex].date}</span>
                <span>{rows[startRange.maxIndex].date}</span>
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
              )}
              height={460}
            />
            <div className="mt-4 grid gap-4 border-t border-slate-200 pt-3 md:grid-cols-3">
              <GapReadout
                color={MODEL_A_COLOR}
                label="Now vs Model A"
                value={formatSignedPercent(analysis.trend.currentDeviation)}
                note="最新指數比長期趨勢線（藍點）高或低多少。"
              />
              <GapReadout
                color={MODEL_B_START_COLOR}
                label={`Now vs Model B since ${selectedStartDate}`}
                value={backtest ? formatSignedPercent(backtest.gap) : "n/a"}
                note={
                  backtest && backtestStartIndex !== null
                    ? `從 ${backtest.originDate} 到現在，指數實際變動 ${formatSignedPercent(backtest.actualLatest / backtestStartIndex - 1)}；照當時為止的長期平均成長率應該是 ${formatSignedPercent(backtest.expectedLatest / backtestStartIndex - 1)}（紅點）。差距就是這段期間多漲或少漲的部分。`
                    : "資料不足，無法比較。"
                }
              />
              <GapReadout
                label="Model A reaches latest index"
                value={formatTrendReachDate(analysis.trendReachLatestIndex)}
                note="趨勢線自己長到現在這個水準的日期。"
              />
            </div>
          </Panel>
        </section>

        {/* Plain-language model explanations */}
        <section className="grid gap-4 pb-5 text-sm leading-6 text-slate-700 lg:grid-cols-3">
          <Explanation
            title="Model A"
            body="Guess: the index keeps returning to one smooth long-term trend line. The line is fitted to the whole history, so it does not pass through the latest index. The gap between the two answers: if the trend line is the normal level, how far above or below it are we now?"
            translation="猜測：指數長期會回到一條平滑的趨勢線附近。這條線用整段歷史估計，所以不會通過最新指數。兩者的差距回答的是：如果趨勢線才是正常水準，現在高了或低了多少？"
          />
          <Explanation
            title="Model B"
            body={`Guess: past rises and falls are never taken back; the index simply continues from wherever it is at its long-run average growth rate. So this model has no fixed line to compare against. You pick a start date with the slider, and the dotted line shows where average growth alone would have taken the index from that date. The gap to the latest index is how much more or less the index moved than an average stretch of the same length. The start date is not the date of a shock; it is only where the counting begins. Set it just before an event begins, as close as you can, to see how much of that event is still in the index; the earlier you set it, the more unrelated moves get mixed in. The default is the last data point before ChatGPT became public on ${DEFAULT_COMPARISON_START_DATE}, which shows the gap since generative AI arrived. The solid orange line is the same average growth continued from the latest index into the future.`}
            translation={`猜測：過去的漲跌不會被收回，指數只是從當下的水準照長期平均成長率繼續走。所以這個模型沒有一條固定的線可以比。你用滑桿選一個起算日，虛線是「從那天起只照平均成長率走」會到的位置；它和最新指數的差距，就是這段期間比平均多漲或少漲了多少。起算日不是衝擊發生的日子，只是開始計算的地方；想知道某次事件還留下多少影響，就把起算日設在事件開始之前、越接近越好；拉得越早，混進的無關漲跌越多。預設值是 ChatGPT 在 ${DEFAULT_COMPARISON_START_DATE} 公開前的最後一筆資料，用來看生成式 AI 出現以來的差距。橘色實線則是從最新指數出發，照同樣的平均成長率往未來延伸。`}
          />
          <Explanation
            title="R-squared"
            body={`R-squared is ${rSquaredValue}, which means Model A's smooth trend line explains about ${rSquaredPercent} of the historical log-index variation. It is not a win rate or forecast accuracy.`}
            translation={`現在的 R-squared 是 ${rSquaredValue}，可以粗略讀成：模型 A 的平滑趨勢線能解釋約 ${rSquaredPercent} 的歷史指數變化。數字越接近 1，代表歷史走勢越貼近這條線；但這不是勝率，也不是預測準確率。`}
          />
        </section>

        {/* Key model and dataset metrics */}
        <section className="grid gap-3 pb-5 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="Latest index"
            value={formatNumber(latest.total_return_index)}
            note={`as of ${latest.date}`}
          />
          <Metric
            label="Model A trend return"
            value={formatPercent(analysis.trend.annualizedTrendReturn)}
          />
          <Metric
            label="Model B drift return"
            value={formatPercent(analysis.randomWalk.annualizedDriftReturn)}
          />
          <Metric label="Sample years" value={formatNumber(loaded.series.sampleYears, 1)} />
          <Metric label="Frequency" value={loaded.series.frequency} />
          <Metric label="Data points" value={formatNumber(loaded.series.rows.length, 0)} />
          <Metric label="R-squared" value={formatNumber(analysis.trend.rSquared, 3)} />
          <Metric
            label="Model B expected today"
            value={
              backtest
                ? formatNumber(backtest.expectedLatest)
                : "n/a"
            }
          />
          <Metric
            label="Model B backtest band"
            value={
              backtest
                ? formatBacktestBand(backtest.inside80, backtest.inside95)
                : "n/a"
            }
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

function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="rounded border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-950">{value}</div>
      {note ? <div className="mt-1 text-xs text-slate-500">{note}</div> : null}
    </div>
  );
}

function GapReadout({
  color,
  label,
  value,
  note,
}: {
  /** Colour of the chart dot this number refers to; omit when there is none. */
  color?: string;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        {color ? (
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: color }}
          />
        ) : null}
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-slate-950">{value}</div>
      <div className="mt-1 text-xs leading-5 text-slate-600">{note}</div>
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
  const backtestPathLabel = analysis.backtest
    ? `Model B: average growth since ${analysis.backtest.originDate}`
    : "Model B: average growth since start date";
  const latestRow = loaded.series.rows[loaded.series.rows.length - 1];
  const backtestStart = analysis.backtest?.path[0];
  const backtestEnd = analysis.backtest?.path[analysis.backtest.path.length - 1];
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
      {
        ...line(
          "Actual index",
          filterVisibleData(historical, visibleDateRange),
          ACTUAL_COLOR,
          2.4,
        ),
        markPoint: dots(ACTUAL_COLOR, [
          [latestRow.date, latestRow.total_return_index],
        ]),
        // Marks where history ends, so the three dots on it read as "now".
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: "#94a3b8", type: "dashed", width: 1 },
          label: { formatter: `Latest ${latestRow.date}`, color: "#475569" },
          data: [{ xAxis: latestRow.date }],
        },
      },
      {
        ...line(
          "Model A fitted trend",
          filterVisibleData(fitted, visibleDateRange),
          MODEL_A_COLOR,
          2,
        ),
        markPoint: dots(MODEL_A_COLOR, [
          [latestRow.date, analysis.trend.latestTrendIndex],
        ]),
      },
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
      {
        ...line(
          backtestPathLabel,
          filterVisibleData(backtestForecast, visibleDateRange),
          MODEL_B_START_COLOR,
          2.2,
          "dotted",
        ),
        markPoint: dots(
          MODEL_B_START_COLOR,
          backtestStart && backtestEnd
            ? [
                [backtestStart.date, backtestStart.expected],
                [backtestEnd.date, backtestEnd.expected],
              ]
            : [],
        ),
      },
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
      position: placeTooltip,
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

const TOOLTIP_CURSOR_GAP = 16;

/**
 * Put the tooltip beside the cursor, flipping to the other side when it would
 * run past the chart edge. ECharts does not clamp the position on its own, and
 * its `confine` option only pushes the box back inside, which then covers the
 * point being read.
 */
export function placeTooltip(
  point: [number, number],
  _params: unknown,
  _el: unknown,
  _rect: unknown,
  size: { contentSize: [number, number]; viewSize: [number, number] },
): [number, number] {
  const [cursorX, cursorY] = point;
  const [boxWidth, boxHeight] = size.contentSize;
  const [viewWidth, viewHeight] = size.viewSize;

  const fitsOnRight = cursorX + TOOLTIP_CURSOR_GAP + boxWidth <= viewWidth;
  const x = fitsOnRight
    ? cursorX + TOOLTIP_CURSOR_GAP
    : cursorX - TOOLTIP_CURSOR_GAP - boxWidth;
  const y = cursorY - boxHeight / 2;

  // A tooltip taller or wider than the chart has no fitting position, so keep
  // its top-left corner in view rather than letting the upper bound go negative.
  return [
    clamp(x, 0, Math.max(0, viewWidth - boxWidth)),
    clamp(y, 0, Math.max(0, viewHeight - boxHeight)),
  ];
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

function dots(color: string, points: [string, number][]) {
  return {
    silent: true,
    symbol: "circle",
    symbolSize: 10,
    label: { show: false },
    itemStyle: { color, borderColor: "#ffffff", borderWidth: 2 },
    data: points.map((coord) => ({ name: coord[0], coord })),
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

function getComparisonStartRange(series: PreparedMarketSeries): {
  minIndex: number;
  maxIndex: number;
} {
  const rows = series.rows;
  const latest = rows[rows.length - 1];
  // Row 0 cannot be a start: the average growth rate before it is unknown.
  const earliestIndex = Math.min(1, rows.length - 1);
  const latestAllowedIndex = Math.max(earliestIndex, rows.length - 2);
  const oldestAllowed = toIsoDate(
    addMonths(latest.dateObj, -MAX_COMPARISON_MONTHS_BACK),
  );
  const newestAllowed = toIsoDate(
    addMonths(latest.dateObj, -MIN_COMPARISON_MONTHS_BACK),
  );
  const firstInside = rows.findIndex((row) => row.date >= oldestAllowed);
  const maxIndex = clamp(
    findLastRowIndexOnOrBefore(rows, newestAllowed),
    earliestIndex,
    latestAllowedIndex,
  );
  const minIndex = clamp(firstInside, earliestIndex, maxIndex);

  return { minIndex, maxIndex };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function formatPercent(value: number): string {
  return `${formatNumber(value * 100, 2)}%`;
}

function formatSignedPercent(value: number): string {
  const text = formatPercent(value);
  // Decide the sign from what is displayed, so a gap that rounds to zero is
  // shown as plain "0.00%" instead of "+0.00%" or "-0.00%".
  if (Number(text.replace(/[%,]/g, "")) === 0) {
    return formatPercent(0);
  }
  return value > 0 ? `+${text}` : text;
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

function formatTrendReachDate(
  reachDate: ReturnType<typeof estimateTrendReachDate>,
): string {
  if (!reachDate) {
    return "Already reached";
  }
  return `${reachDate.date} (${formatNumber(reachDate.yearsFromLatest, 1)}Y)`;
}

function formatNumber(value: number, digits = 2): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}
