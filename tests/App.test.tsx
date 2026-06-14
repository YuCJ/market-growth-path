import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "../src/App";

describe("App", () => {
  it("renders the dashboard shell", () => {
    render(<App />);

    expect(screen.getByText("Market Growth Path")).toBeInTheDocument();
    expect(screen.getByText("Latest index")).toBeInTheDocument();
    expect(screen.getByText("VT weekly adjusted close proxy")).toBeInTheDocument();
  });
});
