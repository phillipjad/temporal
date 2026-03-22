import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ConfidenceChart } from "./ConfidenceChart";

describe("ConfidenceChart", () => {
  it("renders without crashing", () => {
    const { container } = render(
      <ConfidenceChart data={[{ timestamp: "12:00", score: 0.5 }]} />,
    );
    expect(container).toBeDefined();
  });
});
