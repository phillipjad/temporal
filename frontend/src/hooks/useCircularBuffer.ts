import { useState, useCallback } from "react";

export function useCircularBuffer<T>(capacity: number) {
  const [buffer, setBuffer] = useState<T[]>([]);

  const push = useCallback(
    (items: T[]) => {
      setBuffer((prev) => {
        const next = [...prev, ...items];
        if (next.length > capacity) {
          return next.slice(next.length - capacity);
        }
        return next;
      });
    },
    [capacity],
  );

  const clear = useCallback(() => setBuffer([]), []);

  return { buffer, push, clear };
}
