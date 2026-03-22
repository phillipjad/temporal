import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ContributingSignalList } from "./ContributingSignalList";
import type { Signal } from "./ContributingSignalList";

const makeSignal = (overrides: Partial<Signal> = {}): Signal => ({
  id: "signal-1",
  timestamp: "12:00:00",
  source: "Reuters",
  impact: 0.05,
  textSnippet: "Stocks rally on positive economic data.",
  ...overrides,
});

describe("ContributingSignalList", () => {
  it("renders the heading", () => {
    render(<ContributingSignalList signals={[]} />);
    expect(screen.getByText("Contributing Signals")).toBeDefined();
  });

  it("shows empty-state message when there are no signals", () => {
    render(<ContributingSignalList signals={[]} />);
    expect(screen.getByText("No recent signals.")).toBeDefined();
  });

  it("renders a signal's source and text snippet", () => {
    render(<ContributingSignalList signals={[makeSignal()]} />);
    expect(screen.getByText("Reuters")).toBeDefined();
    expect(
      screen.getByText(/"Stocks rally on positive economic data."/),
    ).toBeDefined();
  });

  it("renders a positive impact with a + prefix", () => {
    render(<ContributingSignalList signals={[makeSignal({ impact: 0.12 })]} />);
    expect(screen.getByText("+0.12")).toBeDefined();
  });

  it("renders a negative impact without a + prefix", () => {
    render(
      <ContributingSignalList signals={[makeSignal({ impact: -0.08 })]} />,
    );
    expect(screen.getByText("-0.08")).toBeDefined();
  });

  it("renders a zero impact without a + prefix", () => {
    render(<ContributingSignalList signals={[makeSignal({ impact: 0 })]} />);
    expect(screen.getByText("0.00")).toBeDefined();
  });

  it("renders multiple signals", () => {
    const signals = [
      makeSignal({ id: "1", source: "Bloomberg", impact: 0.1 }),
      makeSignal({ id: "2", source: "AP News", impact: -0.05 }),
    ];
    render(<ContributingSignalList signals={signals} />);
    expect(screen.getByText("Bloomberg")).toBeDefined();
    expect(screen.getByText("AP News")).toBeDefined();
  });

  it("renders the timestamp for each signal", () => {
    render(
      <ContributingSignalList
        signals={[makeSignal({ timestamp: "09:30:00" })]}
      />,
    );
    expect(screen.getByText("09:30:00")).toBeDefined();
  });
});
