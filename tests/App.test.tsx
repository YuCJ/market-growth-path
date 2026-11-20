import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App, { placeTooltip } from "../src/App";
import {
  canonicalDatasets,
  loadCanonicalDataset,
} from "../src/data/canonicalDatasets";

describe("App", () => {
  it("renders the dashboard shell", () => {
    render(<App />);

    expect(screen.getByText("Market Growth Path")).toBeInTheDocument();
    expect(screen.getByText("Latest index")).toBeInTheDocument();
    expect(screen.getByLabelText("Dataset")).toHaveValue(
      "market-total-return-iwda-lon-weekly-v1",
    );
    expect(screen.getByLabelText("Y axis")).toHaveValue("value");
  });

  it("starts the Model B comparison just before ChatGPT became public by default", () => {
    // Earlier renders stay in the document in this suite, so look only inside
    // this render's container.
    const view = within(render(<App />).container);

    // IWDA.LON has weekly rows on 2022-11-25 and 2022-12-02.
    expect(view.getByText("Now vs Model B since 2022-11-25")).toBeInTheDocument();
  });

  it("moves the Model B comparison start date with the slider", () => {
    const { container } = render(<App />);
    const view = within(container);
    const dataset = loadCanonicalDataset(
      canonicalDatasets.find(
        (candidate) => candidate.id === "market-total-return-iwda-lon-weekly-v1",
      )!,
    );
    const rows = dataset.series.rows;

    const slider = container.querySelector('input[type="range"]');
    expect(slider).not.toBeNull();
    expect(slider).toHaveAttribute("step", "1");
    const minIndex = Number(slider!.getAttribute("min"));
    const maxIndex = Number(slider!.getAttribute("max"));
    expect(minIndex).toBeGreaterThanOrEqual(1);
    expect(maxIndex).toBeLessThan(rows.length - 1);

    fireEvent.input(slider!, { target: { value: String(minIndex + 10) } });

    expect(slider).toHaveValue(String(minIndex + 10));
    expect(
      view.getByText(`Now vs Model B since ${rows[minIndex + 10].date}`),
    ).toBeInTheDocument();
    expect(view.getByText("Now vs Model A")).toBeInTheDocument();
  });
});

describe("placeTooltip", () => {
  const size = {
    contentSize: [120, 60] as [number, number],
    viewSize: [400, 200] as [number, number],
  };
  const place = (x: number, y: number) =>
    placeTooltip([x, y], null, null, null, size);

  it("puts the tooltip to the right of the cursor when it fits", () => {
    expect(place(100, 100)).toEqual([116, 70]);
  });

  it("flips to the left of the cursor near the right edge", () => {
    expect(place(380, 100)).toEqual([244, 70]);
  });

  it("never places the tooltip outside the chart", () => {
    const [x, y] = place(5, 5);

    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
  });
});
