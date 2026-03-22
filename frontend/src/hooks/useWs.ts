import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { components } from "../lib/api.types";

type WsMessage = components["schemas"]["WsMessage"];
type WsSignalEvent = components["schemas"]["WsSignalEvent"];

export function useWs(url: string) {
  const queryClient = useQueryClient();
  const bufferRef = useRef<WsMessage[]>([]);

  useEffect(() => {
    if (!url) return;

    const ws = new WebSocket(url);

    ws.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data) as WsMessage;
        bufferRef.current.push(msg);
      } catch (e) {
        console.error("Failed to parse WS message", e);
      }
    });

    // Batched 200ms flush interval (ARCHITECTURE_PLAN.md §13.6)
    const interval = setInterval(() => {
      // Suspend flush while the tab is hidden (AGENTS.md §7.5)
      if (document.hidden) return;

      if (bufferRef.current.length === 0) return;

      const messages = [...bufferRef.current];
      bufferRef.current = [];

      console.debug("Flushed WS messages:", messages);

      const signalItems = messages
        .filter((m): m is WsSignalEvent => m.type === "signal_event")
        .map((m) => m);

      if (signalItems.length > 0) {
        window.dispatchEvent(
          new CustomEvent<WsSignalEvent[]>("temporal:signal_event", {
            detail: signalItems,
          }),
        );
      }

      const hasConfidenceUpdate = messages.some(
        (m) => m.type === "confidence_update",
      );
      if (hasConfidenceUpdate) {
        queryClient.invalidateQueries({ queryKey: ["markets"] });
        queryClient.invalidateQueries({ queryKey: ["confidence"] });
      }
    }, 200);

    return () => {
      ws.close();
      clearInterval(interval);
    };
  }, [url, queryClient]);
}
