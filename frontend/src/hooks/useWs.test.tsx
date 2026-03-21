import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useWs } from "./useWs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// Mock WebSocket class
const mockWsInstances: MockWebSocket[] = [];

class MockWebSocket {
  url: string;
  onmessage: ((event: unknown) => void) | null = null;
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    mockWsInstances.push(this);
  }
}

describe("useWs", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
    mockWsInstances.length = 0;
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it("buffers and flushes messages every 200ms", () => {
    const debugMock = vi.spyOn(console, "debug").mockImplementation(() => {});

    renderHook(() => useWs("ws://localhost:8080/ws"), { wrapper });

    const ws = mockWsInstances[0];
    expect(ws).toBeDefined();

    // Send a message
    if (ws.onmessage) {
      ws.onmessage({
        data: JSON.stringify({ type: "news_event", payload: {} }),
      });
    }

    // Haven't flushed yet
    expect(debugMock).not.toHaveBeenCalled();

    // Advance 200ms
    vi.advanceTimersByTime(200);

    // Now it should flush
    expect(debugMock).toHaveBeenCalledWith("Flushed WS messages:", [
      { type: "news_event", payload: {} },
    ]);

    debugMock.mockRestore();
  });

  it("does not flush when document is hidden", () => {
    const debugMock = vi.spyOn(console, "debug").mockImplementation(() => {});

    // Mock document.hidden to be true
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });

    renderHook(() => useWs("ws://localhost:8080/ws"), { wrapper });

    const ws = mockWsInstances[0];

    if (ws.onmessage) {
      ws.onmessage({
        data: JSON.stringify({ type: "confidence_update", payload: {} }),
      });
    }

    // Advance 200ms
    vi.advanceTimersByTime(200);

    // Should NOT flush because document is hidden
    expect(debugMock).not.toHaveBeenCalled();

    // Make visible again
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });

    // Advance again
    vi.advanceTimersByTime(200);

    // Now it should flush
    expect(debugMock).toHaveBeenCalledWith("Flushed WS messages:", [
      { type: "confidence_update", payload: {} },
    ]);

    debugMock.mockRestore();
  });
});
