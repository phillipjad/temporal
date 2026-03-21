import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useCircularBuffer } from './useCircularBuffer';

describe('useCircularBuffer', () => {
  it('should maintain buffer up to capacity', () => {
    const { result } = renderHook(() => useCircularBuffer<number>(3));

    // Initial state
    expect(result.current.buffer).toEqual([]);

    // Push under capacity
    act(() => {
      result.current.push([1, 2]);
    });
    expect(result.current.buffer).toEqual([1, 2]);

    // Push over capacity
    act(() => {
      result.current.push([3, 4]);
    });
    // Expected: last 3 items
    expect(result.current.buffer).toEqual([2, 3, 4]);
  });

  it('should clear buffer', () => {
    const { result } = renderHook(() => useCircularBuffer<number>(3));
    act(() => {
      result.current.push([1, 2, 3]);
    });
    expect(result.current.buffer).toHaveLength(3);

    act(() => {
      result.current.clear();
    });
    expect(result.current.buffer).toEqual([]);
  });
});
