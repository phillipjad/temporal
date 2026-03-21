import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

export function useWs(url: string) {
  const queryClient = useQueryClient();
  const bufferRef = useRef<unknown[]>([]);

  useEffect(() => {
    // Only attempt connection if we have a URL
    if (!url) return;

    const ws = new WebSocket(url);

    ws.onmessage = (event) => {
      try {
        // Parse the message and push it to the buffer ref
        // to avoid calling setState directly on the WebSocket event wrapper
        const msg = JSON.parse(event.data);
        bufferRef.current.push(msg);
      } catch (e) {
        console.error("Failed to parse WS message", e);
      }
    };

    // Fast 200ms batched interval (ADR constraint)
    const interval = setInterval(() => {
      // Suspend component updates if the document is hidden
      if (document.hidden) return;

      if (bufferRef.current.length > 0) {
        const messages = [...bufferRef.current];
        bufferRef.current = [];

        // Apply events to query data
        // Example: queryClient.invalidateQueries(...)
        // Further mapping happens here against specific domains
        console.debug("Flushed WS messages:", messages);
      }
    }, 200);

    return () => {
      ws.close();
      clearInterval(interval);
    };
  }, [url, queryClient]);
}
