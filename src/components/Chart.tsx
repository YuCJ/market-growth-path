import { BarChart, LineChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { init, use, type EChartsCoreOption } from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";

use([
  BarChart,
  GridComponent,
  LegendComponent,
  LineChart,
  SVGRenderer,
  TooltipComponent,
]);

type ChartProps = {
  option: EChartsCoreOption;
  height?: number;
};

export function Chart({ option, height = 360 }: ChartProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  if (import.meta.env.MODE === "test") {
    return <div data-testid="chart" style={{ height }} className="w-full" />;
  }

  useEffect(() => {
    if (!ref.current) {
      return;
    }

    const chart = init(ref.current, undefined, { renderer: "svg" });
    chart.setOption(option);
    const resize = () => chart.resize();
    window.addEventListener("resize", resize);

    return () => {
      window.removeEventListener("resize", resize);
      chart.dispose();
    };
  }, [option]);

  return <div ref={ref} style={{ height }} className="w-full" />;
}
