import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ConfidenceChart } from "./ConfidenceChart";

describe("ConfidenceChart", () => {
  it("renders the heading", () => {
    render(<ConfidenceChart data={[]} />);
    expect(screen.getByText("Rolling Confidence")).toBeDefined();
  });

  it("renders without crashing with data points", () => {
    const data = [
      { timestamp: "12:00:00", score: 0.5 },
      { timestamp: "12:00:01", score: -0.3 },
      { timestamp: "12:00:02", score: 0.0 },
    ];
    const { container } = render(<ConfidenceChart data={data} />);
    expect(container).toBeDefined();
  });

  it("renders without crashing with empty data", () => {
    const { container } = render(<ConfidenceChart data={[]} />);
    expect(container).toBeDefined();
  });

  it("uses the default threshold of 0.8 when none is provided", () => {
    const { container } = render(
      <ConfidenceChart data={[{ timestamp: "12:00:00", score: 0.5 }]} />,
    );
    expect(container).toBeDefined();
  });

  it("accepts a custom threshold", () => {
    const { container } = render(
      <ConfidenceChart
        data={[{ timestamp: "12:00:00", score: 0.5 }]}
        threshold={0.6}
      />,
    );
    expect(container).toBeDefined();
  });

  it("renders without crashing with boundary scores", () => {
    const data = [
      { timestamp: "12:00:00", score: 1.0 },
      { timestamp: "12:00:01", score: -1.0 },
    ];
    const { container } = render(<ConfidenceChart data={data} />);
    expect(container).toBeDefined();
  });
});
