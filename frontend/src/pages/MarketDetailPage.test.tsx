import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MarketDetailPage } from "./MarketDetailPage";

describe("MarketDetailPage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the market ID in the heading", () => {
    render(<MarketDetailPage marketId="MARKET-XYZ" />);
    expect(screen.getByText(/Market Details: MARKET-XYZ/)).toBeDefined();
  });

  it("renders N/A when marketId is empty", () => {
    render(<MarketDetailPage marketId="" />);
    expect(screen.getByText(/Market Details: N\/A/)).toBeDefined();
  });

  it("renders the ConfidenceChart heading", () => {
    render(<MarketDetailPage marketId="MARKET-1" />);
    expect(screen.getByText("Rolling Confidence")).toBeDefined();
  });

  it("renders the ContributingSignalList heading", () => {
    render(<MarketDetailPage marketId="MARKET-1" />);
    expect(screen.getByText("Contributing Signals")).toBeDefined();
  });

  it("starts with empty signal list showing no-signals message", () => {
    render(<MarketDetailPage marketId="MARKET-1" />);
    expect(screen.getByText("No recent signals.")).toBeDefined();
  });
});
