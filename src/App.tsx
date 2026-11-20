import type { EChartsOption } from "echarts";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import {
  calculateRollingReturns,
  fitBrokenTrend,
  fitDeterministicTrend,
  estimateTrendReachDate,
  findLastRowIndexOnOrBefore,
  generateBrokenTrendExtension,
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
// ChatGPT became public on 2022-11-30. By default Model B lets the growth rate
// change at the last data point on or before that day, so its line reads as
// "the trend if generative AI changed how fast the index grows".
const DEFAULT_GROWTH_CHANGE_DATE = "2022-11-30";
// A growth rate read from less than a year of data is mostly noise.
const MIN_CHANGE_MONTHS_BACK = 12;
// The main chart widens to include the change date, so this caps how far the
// chart can be stretched.
const MAX_CHANGE_MONTHS_BACK = 120;
const ROLLING_WINDOWS = [5, 10, 20];
const ACTUAL_COLOR = "#0f766e";
const MODEL_A_COLOR = "#2563eb";
const MODEL_B_COLOR = "#b45309";

type Analysis = {
  trend: ReturnType<typeof fitDeterministicTrend>;
  brokenTrend: ReturnType<typeof fitBrokenTrend>;
  brokenTrendExtension: ReturnType<typeof generateBrokenTrendExtension>;
  trendExtension: ReturnType<typeof generateTrendExtension>;
  trendReachLatestIndex: ReturnType<typeof estimateTrendReachDate>;
  rollingReturns: ReturnType<typeof calculateRollingReturns>;
};

type ChartPoint = [string, number | null];

const DEFAULT_DATASET_ID = "market-total-return-iwda-lon-weekly-v1";

export default function App() {
  const [datasetId, setDatasetId] = useState(DEFAULT_DATASET_ID);
  const [yScale, setYScale] = useState<"log" | "value">("value");
  const [growthChangeDate, setGrowthChangeDate] = useState(
    DEFAULT_GROWTH_CHANGE_DATE,
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
  const changeRange = useMemo(
    () => getGrowthChangeRange(loaded.series),
    [loaded],
  );
  // The chosen date is kept as a calendar date, so it stays on the same event
  // when the dataset changes or new weekly data arrives. Each dataset then
  // maps it to its own nearest earlier row.
  const selectedChangeIndex = clamp(
    findLastRowIndexOnOrBefore(rows, growthChangeDate),
    changeRange.minIndex,
    changeRange.maxIndex,
  );
  const selectedChangeDate = rows[selectedChangeIndex].date;
  const analysis = useMemo(() => {
    const trend = fitDeterministicTrend(loaded.series);
    const brokenTrend = fitBrokenTrend(loaded.series, selectedChangeDate);
    return {
      trend,
      brokenTrend,
      brokenTrendExtension: brokenTrend
        ? generateBrokenTrendExtension(loaded.series, brokenTrend, FORECAST_YEARS)
        : [],
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
  }, [loaded, selectedChangeDate]);
  const latest = loaded.series.rows[loaded.series.rows.length - 1];
  const brokenTrend = analysis.brokenTrend;
  const updateGrowthChangeDate = (rowIndex: string) =>
    setGrowthChangeDate(rows[Number(rowIndex)].date);
  const rSquaredValue = formatNumber(analysis.trend.rSquared, 3);
  const rSquaredPercent = formatPercent(analysis.trend.rSquared);
  const defaultVisibleStart = toIsoDate(addYears(latest.dateObj, -5));
  const visibleDateRange = {
    // A change date more than five years back would otherwise sit outside the
    // chart, hiding the point where the Model B line bends.
    min:
      selectedChangeDate < defaultVisibleStart
        ? selectedChangeDate
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
              Two trend lines for the selected market dataset: one with a single
              growth rate, one whose growth rate changes once.
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
                <span>Model B growth rate changes on</span>
                <span className="font-semibold text-slate-950">
                  {`${selectedChangeDate} (${formatNumber(
                    elapsedYears(rows[selectedChangeIndex].dateObj, latest.dateObj),
                    1,
                  )} years ago)`}
                </span>
              </span>
              <input
                aria-label="Model B growth rate change date"
                className="h-10 w-full accent-teal-700"
                type="range"
                min={changeRange.minIndex}
                max={changeRange.maxIndex}
                step={1}
                value={selectedChangeIndex}
                onInput={(event) =>
                  updateGrowthChangeDate(event.currentTarget.value)
                }
                onChange={(event) =>
                  updateGrowthChangeDate(event.currentTarget.value)
                }
              />
              <span className="flex justify-between text-xs text-slate-500">
                <span>{rows[changeRange.minIndex].date}</span>
                <span>{rows[changeRange.maxIndex].date}</span>
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
          <Panel title="Index and model trend lines">
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
                note="如果成長率從頭到尾沒變（藍線），最新指數比線高或低多少。"
              />
              <GapReadout
                color={MODEL_B_COLOR}
                label="Now vs Model B"
                value={
                  brokenTrend
                    ? formatSignedPercent(brokenTrend.currentDeviation)
                    : "n/a"
                }
                note={`如果成長率在 ${selectedChangeDate} 改變了（橘線），最新指數比線高或低多少。`}
              />
              <GapReadout
                label="Model B growth rate a year"
                value={
                  brokenTrend
                    ? `${formatPercent(brokenTrend.annualizedReturnBefore)} → ${formatPercent(brokenTrend.annualizedReturnAfter)}`
                    : "n/a"
                }
                note={
                  brokenTrend
                    ? `${selectedChangeDate} 之前與之後的每年成長率。之後只有 ${formatNumber(brokenTrend.yearsAfterBreak, 1)} 年資料，後面這個數字的誤差大約是正負 ${formatNumber(brokenTrend.annualizedReturnAfterUncertainty * 100, 0)} 個百分點。`
                    : "這個日期前後的資料不足，無法估計。"
                }
              />
            </div>
          </Panel>
        </section>

        {/* Plain-language model explanations */}
        <section className="grid gap-4 pb-5 text-sm leading-6 text-slate-700 lg:grid-cols-3">
          <Explanation
            title="Model A"
            body="Guess: the growth rate has been the same all along. One smooth trend line is fitted to the whole history. Its gap to the latest index answers: if nothing has changed, how far above or below the normal level are we now?"
            translation="猜測：成長率從頭到尾都一樣。用整段歷史估出一條平滑的趨勢線。它和最新指數的差距回答的是：如果什麼都沒變，現在比正常水準高或低多少？"
          />
          <Explanation
            title="Model B"
            body={`Guess: the growth rate changed once, on the date set with the slider. It is still one line, but it bends on that date: one growth rate before, another after, and the dashed part continues the later rate into the future. The default date is the last data point before ChatGPT became public on ${DEFAULT_GROWTH_CHANGE_DATE}, so the line shows the trend if generative AI changed how fast the index grows. Two cautions. The later growth rate comes from only a few years of data, so it is rough and will move as new data arrives. And a temporary surge looks the same as a lasting change over a few years: a small gap to Model B with a large gap to Model A means recent prices fit "growth sped up" better than "nothing changed", not that the speed-up will last.`}
            translation={`猜測：成長率在滑桿選的那一天改變了一次。它仍然是一條線，只是在那一天轉彎：之前一個成長率、之後另一個，虛線部分是照之後的成長率往未來延伸。預設日期是 ChatGPT 在 ${DEFAULT_GROWTH_CHANGE_DATE} 公開前的最後一筆資料，所以這條線代表「如果生成式 AI 改變了指數成長的速度」的趨勢。兩個提醒：之後的成長率只靠幾年資料估計，很粗略，新資料進來還會變動。另外，短短幾年內，暫時的大漲和長期的改變看起來一模一樣；離模型 B 很近、離模型 A 很遠，只代表最近的價格比較符合「成長變快了」而不是「什麼都沒變」，不代表會一直這麼快。`}
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
            label="Model A reaches latest index"
            value={formatTrendReachDate(analysis.trendReachLatestIndex)}
          />
          <Metric label="Sample years" value={formatNumber(loaded.series.sampleYears, 1)} />
          <Metric label="Frequency" value={loaded.series.frequency} />
          <Metric label="Data points" value={formatNumber(loaded.series.rows.length, 0)} />
          <Metric label="R-squared" value={formatNumber(analysis.trend.rSquared, 3)} />
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
            <Panel title="Deviation from each model's trend line">
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
  const brokenFitted: ChartPoint[] =
    analysis.brokenTrend?.fitted.map((point) => [point.date, point.trendIndex]) ??
    [];
  const brokenExtension: ChartPoint[] = analysis.brokenTrendExtension.map(
    (point) => [point.date, point.trendIndex],
  );
  const latestRow = loaded.series.rows[loaded.series.rows.length - 1];
  const bend = analysis.brokenTrend?.fitted[analysis.brokenTrend.breakIndex];
  const visiblePrimaryLines = [
    ...filterVisibleData(historical, visibleDateRange),
    ...filterVisibleData(fitted, visibleDateRange),
    ...filterVisibleData(trendExtension, visibleDateRange),
    ...filterVisibleData(brokenFitted, visibleDateRange),
    ...filterVisibleData(brokenExtension, visibleDateRange),
  ];

  return baseChartOption({
    yScale,
    yRange: paddedYRange(visiblePrimaryLines, yScale),
    visibleDateRange,
    legend: [
      "Actual index",
      "Model A fitted trend",
      "Model A extension",
      "Model B fitted trend",
      "Model B extension",
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
      {
        ...line(
          "Model B fitted trend",
          filterVisibleData(brokenFitted, visibleDateRange),
          MODEL_B_COLOR,
          2,
        ),
        // One dot where the line bends, one for its value at the latest date.
        markPoint: dots(
          MODEL_B_COLOR,
          analysis.brokenTrend && bend
            ? [
                [bend.date, bend.trendIndex],
                [latestRow.date, analysis.brokenTrend.latestTrendIndex],
              ]
            : [],
        ),
      },
      line(
        "Model B extension",
        filterVisibleData(brokenExtension, visibleDateRange),
        "#f59e0b",
        2,
        "dashed",
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
    legend: ["Model A", "Model B"],
    series: [
      line(
        "Model A",
        filterVisibleData(
          analysis.trend.fitted.map((point) => [point.date, point.deviation]),
          visibleDateRange,
        ),
        MODEL_A_COLOR,
        2,
      ),
      line(
        "Model B",
        filterVisibleData(
          analysis.brokenTrend?.fitted.map((point) => [
            point.date,
            point.deviation,
          ]) ?? [],
          visibleDateRange,
        ),
        MODEL_B_COLOR,
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

function getGrowthChangeRange(series: PreparedMarketSeries): {
  minIndex: number;
  maxIndex: number;
} {
  const rows = series.rows;
  const latest = rows[rows.length - 1];
  // Model B needs at least three rows before the change date to read a
  // growth rate from them.
  const earliestIndex = Math.min(2, rows.length - 1);
  // ...and at least three rows after it.
  const latestAllowedIndex = Math.max(earliestIndex, rows.length - 4);
  const oldestAllowed = toIsoDate(
    addMonths(latest.dateObj, -MAX_CHANGE_MONTHS_BACK),
  );
  const newestAllowed = toIsoDate(
    addMonths(latest.dateObj, -MIN_CHANGE_MONTHS_BACK),
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
