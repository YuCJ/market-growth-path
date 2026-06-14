import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "../src/App";

describe("App", () => {
  it("renders the application shell", () => {
    render(<App />);

    expect(screen.getByText("Market Growth Path")).toBeInTheDocument();
    expect(screen.getByText("TypeScript strict mode")).toBeInTheDocument();
  });
});
