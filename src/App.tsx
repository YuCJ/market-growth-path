import type { EChartsOption } from "echarts";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import {
  calculateRollingReturns,
  fitDeterministicTrend,
  fitRandomWalkWithDrift,
  generateForecast,
  generateTrendExtension,
} from "./analytics/models";
import { Chart } from "./components/Chart";
import {
  canonicalDatasets,
  loadCanonicalDataset,
} from "./data/canonicalDatasets";

const FORECAST_YEARS = 30;
const ROLLING_WINDOWS = [5, 10, 20];

type Analysis = {
  trend: ReturnType<typeof fitDeterministicTrend>;
  randomWalk: ReturnType<typeof fitRandomWalkWithDrift>;
  forecast: ReturnType<typeof generateForecast>;
  trendExtension: ReturnType<typeof generateTrendExtension>;
  rollingReturns: ReturnType<typeof calculateRollingReturns>;
};

export default function App() {
  const [datasetId, setDatasetId] = useState(canonicalDatasets[0].id);
  const [yScale, setYScale] = useState<"log" | "value">("log");
  const loaded = useMemo(
    () =>
      loadCanonicalDataset(
        canonicalDatasets.find((dataset) => dataset.id === datasetId) ??
          canonicalDatasets[0],
      ),
    [datasetId],
  );
  const analysis = useMemo(() => {
    const trend = fitDeterministicTrend(loaded.series);
    const randomWalk = fitRandomWalkWithDrift(loaded.series);
    return {
      trend,
      randomWalk,
      forecast: generateForecast(loaded.series, randomWalk, FORECAST_YEARS),
      trendExtension: generateTrendExtension(
        loaded.series,
        trend,
        FORECAST_YEARS,
      ),
      rollingReturns: calculateRollingReturns(loaded.series, ROLLING_WINDOWS),
    };
  }, [loaded]);
  const latest = loaded.series.rows[loaded.series.rows.length - 1];

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
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

        <section className="grid gap-3 py-5 sm:grid-cols-2 lg:grid-cols-4">
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
          <Metric
            label="Model B annual volatility"
            value={formatPercent(analysis.randomWalk.annualizedInnovationSd)}
          />
          <Metric label="R-squared" value={formatNumber(analysis.trend.rSquared, 3)} />
        </section>

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

        <section className="grid gap-5">
          <Panel title="Index, trend, and forecast paths">
            <Chart option={buildMainChart(loaded, analysis, yScale)} height={460} />
          </Panel>

          <div className="grid gap-5 xl:grid-cols-2">
            <Panel title="Deviation from deterministic trend">
              <Chart option={buildDeviationChart(analysis)} />
            </Panel>
            <Panel title="Log returns and rolling annualized returns">
              <Chart option={buildReturnsChart(loaded, analysis)} />
            </Panel>
          </div>
        </section>

        <section className="mt-5 grid gap-4 border-t border-slate-200 pt-5 text-sm leading-6 text-slate-700 lg:grid-cols-2">
          <Explanation
            title="Model A"
            body="Assumes the historical log index moves around one smooth long-term time trend. The line is fitted with the full history, so it does not need to pass through today's index."
          />
          <Explanation
            title="Model B"
            body="Assumes log returns have a long-run average drift, while market shocks permanently change the index level. The expected future path starts from the latest actual index."
          />
          <Explanation
            title="R-squared"
            body="Shows how closely historical data follows Model A's smooth trend line. It is not a win rate, not forecast accuracy, and not evidence that the market must return to the trend."
          />
          <Explanation
            title="Forecast interval"
            body="Shows a possible future range under the simplified random walk model, estimated from historical volatility. The range widens over time and is not the most likely actual path."
          />
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

function Explanation({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h3 className="font-semibold text-slate-950">{title}</h3>
      <p className="mt-1">{body}</p>
    </div>
  );
}

function buildMainChart(
  loaded: ReturnType<typeof loadCanonicalDataset>,
  analysis: Analysis,
  yScale: "log" | "value",
): EChartsOption {
  const historical = loaded.series.rows.map((row) => [
    row.date,
    row.total_return_index,
  ]);
  const fitted = analysis.trend.fitted.map((point) => [
    point.date,
    point.trendIndex,
  ]);
  const trendExtension = analysis.trendExtension.map((point) => [
    point.date,
    point.trendIndex,
  ]);
  const forecast = analysis.forecast.map((point) => [point.date, point.expected]);

  return baseChartOption({
    yScale,
    legend: [
      "Actual index",
      "Model A fitted trend",
      "Model A extension",
      "Model B expected path",
      "80% lower",
      "80% upper",
      "95% lower",
      "95% upper",
    ],
    series: [
      line("Actual index", historical, "#0f766e", 2.4),
      line("Model A fitted trend", fitted, "#2563eb", 2),
      line("Model A extension", trendExtension, "#60a5fa", 2, "dashed"),
      line("Model B expected path", forecast, "#b45309", 2.4),
      line(
        "80% lower",
        analysis.forecast.map((point) => [point.date, point.lower80]),
        "#f59e0b",
        1,
        "dotted",
      ),
      line(
        "80% upper",
        analysis.forecast.map((point) => [point.date, point.upper80]),
        "#f59e0b",
        1,
        "dotted",
      ),
      line(
        "95% lower",
        analysis.forecast.map((point) => [point.date, point.lower95]),
        "#fbbf24",
        1,
        "dashed",
      ),
      line(
        "95% upper",
        analysis.forecast.map((point) => [point.date, point.upper95]),
        "#fbbf24",
        1,
        "dashed",
      ),
    ],
  });
}

function buildDeviationChart(
  analysis: Analysis,
): EChartsOption {
  return baseChartOption({
    yScale: "value",
    yFormatter: (value) => `${formatNumber(Number(value) * 100, 0)}%`,
    legend: ["Deviation"],
    series: [
      line(
        "Deviation",
        analysis.trend.fitted.map((point) => [point.date, point.deviation]),
        "#7c3aed",
        2,
      ),
    ],
  });
}

function buildReturnsChart(
  loaded: ReturnType<typeof loadCanonicalDataset>,
  analysis: Analysis,
): EChartsOption {
  const logReturns = loaded.series.rows.slice(1).map((row, index) => [
    row.date,
    row.logIndex - loaded.series.rows[index].logIndex,
  ]);
  const rollingSeries = ROLLING_WINDOWS.map((windowYears) =>
    line(
      `${windowYears}Y rolling`,
      analysis.rollingReturns
        .map((point) => [point.date, point.returns[windowYears]])
        .filter(([, value]) => value !== null) as [string, number][],
      rollingColor(windowYears),
      2,
    ),
  );

  return baseChartOption({
    yScale: "value",
    yFormatter: (value) => `${formatNumber(Number(value) * 100, 0)}%`,
    legend: ["Log return", ...ROLLING_WINDOWS.map((years) => `${years}Y rolling`)],
    series: [
      {
        ...line("Log return", logReturns, "#64748b", 1),
        type: "bar",
      },
      ...rollingSeries,
    ],
  });
}

function baseChartOption({
  yScale,
  legend,
  series,
  yFormatter,
}: {
  yScale: "log" | "value";
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
      axisLine: { lineStyle: { color: "#cbd5e1" } },
      axisLabel: { color: "#64748b" },
    },
    yAxis: {
      type: yScale,
      axisLine: { lineStyle: { color: "#cbd5e1" } },
      axisLabel: {
        color: "#64748b",
        formatter: yFormatter,
      },
      splitLine: { lineStyle: { color: "#e2e8f0" } },
    },
    series,
  };
}

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

function rollingColor(windowYears: number): string {
  if (windowYears === 5) {
    return "#0f766e";
  }
  if (windowYears === 10) {
    return "#2563eb";
  }
  return "#b45309";
}

function formatPercent(value: number): string {
  return `${formatNumber(value * 100, 2)}%`;
}

function formatNumber(value: number, digits = 2): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}
