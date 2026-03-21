import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { components } from "../lib/api.types";

type WsMessage = components["schemas"]["WsMessage"];
type NewsEvent = components["schemas"]["NewsEvent"];

export function useWs(url: string) {
  const queryClient = useQueryClient();
  const bufferRef = useRef<WsMessage[]>([]);

  useEffect(() => {
    // Only attempt connection if we have a URL
    if (!url) return;

    const ws = new WebSocket(url);

    ws.addEventListener("message", (event) => {
      try {
        // Parse the message and push it to the buffer ref
        // to avoid calling setState directly on the WebSocket event handler
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

      const newsItems = messages
        .filter((m) => m.type === "news_event")
        .map((m) => (m.payload as unknown) as NewsEvent);

      if (newsItems.length > 0) {
        window.dispatchEvent(
          new CustomEvent<NewsEvent[]>("temporal:news_event", {
            detail: newsItems,
          }),
        );
      }

      const hasConfidenceUpdate = messages.some(
        (m) => m.type === "confidence_update",
      );
      if (hasConfidenceUpdate) {
        queryClient.invalidateQueries({ queryKey: ["markets"] });
      }
    }, 200);

    return () => {
      ws.close();
      clearInterval(interval);
    };
  }, [url, queryClient]);
}
