import vtWeeklyCsv from "../../data/canonical/market-total-return-vt-weekly.v1.csv?raw";
import iwdaLonWeeklyCsv from "../../data/canonical/market-total-return-iwda.lon-weekly.v1.csv?raw";
import { parseCanonicalCsv, prepareMarketSeries } from "./canonicalCsv";

export type CanonicalDataset = {
  id: string;
  name: string;
  description: string;
  csv: string;
};

export const canonicalDatasets: CanonicalDataset[] = [
  {
    id: "market-total-return-vt-weekly-v1",
    name: "VT weekly adjusted close proxy",
    description:
      "VT adjusted close rebased to 100, used as a global equity market growth proxy.",
    csv: vtWeeklyCsv,
  },
  {
    id: "market-total-return-iwda-lon-weekly-v1",
    name: "IWDA.LON weekly adjusted close proxy",
    description:
      "IWDA.LON adjusted close rebased to 100, used as a developed-market MSCI World ETF proxy.",
    csv: iwdaLonWeeklyCsv,
  },
];

export function loadCanonicalDataset(dataset: CanonicalDataset) {
  const rows = parseCanonicalCsv(dataset.csv);
  const series = prepareMarketSeries(rows);
  const latest = series.rows[series.rows.length - 1];
  const first = series.rows[0];

  return {
    dataset,
    series,
    metadata: {
      provider: latest.provider ?? "unknown",
      symbol: latest.symbol ?? "unknown",
      sourceField: latest.source_field ?? "unknown",
      startDate: first.date,
      endDate: latest.date,
    },
  };
}
