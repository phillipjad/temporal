import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AutoTradingToggle } from "./AutoTradingToggle";

describe("AutoTradingToggle", () => {
  it("disables the confirm button until the exact phrase is typed", () => {
    const handleToggle = vi.fn();
    render(<AutoTradingToggle currentStatus={false} onToggle={handleToggle} />);

    // Click enable to show confirmation form
    const enableBtn = screen.getByText("Enable Auto-Trading");
    fireEvent.click(enableBtn);

    const input = screen.getByPlaceholderText(
      "I understand the risks of real money trading",
    );
    const confirmBtn = screen.getByText("Confirm & Enable");

    // Button should be disabled initially
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(true);

    // Type incorrect phrase
    fireEvent.change(input, { target: { value: "I understand the risks" } });
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(true);

    // Type exact phrase
    fireEvent.change(input, {
      target: { value: "I understand the risks of real money trading" },
    });
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(false);

    // Click form enabled confirmation
    fireEvent.click(confirmBtn);
    expect(handleToggle).toHaveBeenCalledWith(true);
  });
});
