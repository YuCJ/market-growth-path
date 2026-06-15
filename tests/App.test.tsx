import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "../src/App";

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

  it("updates the Model B backtest lookback from the month slider", () => {
    const { container } = render(<App />);

    const slider = container.querySelector('input[type="range"]');
    expect(slider).not.toBeNull();
    expect(slider).toHaveAttribute("min", "3");
    expect(slider).toHaveAttribute("max", "120");
    expect(slider).toHaveAttribute("step", "1");
    expect(screen.getAllByText("1Y forecast gap").length).toBeGreaterThan(0);

    fireEvent.input(slider!, { target: { value: "18" } });

    expect(slider).toHaveValue("18");
    expect(screen.getAllByText("18M forecast gap").length).toBeGreaterThan(0);
    expect(screen.getAllByText("18M origin date").length).toBeGreaterThan(0);
  });
});
