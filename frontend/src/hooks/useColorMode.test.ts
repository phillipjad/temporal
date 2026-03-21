// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useColorMode } from './useColorMode';
import { useConfigStore } from '../stores/useConfigStore';

describe('useColorMode', () => {
  beforeEach(() => {
    // Reset Zustand store state before each test
    useConfigStore.setState({ colorMode: 'light' });
  });

  it('should initialize with light mode if store has light mode', () => {
    useConfigStore.setState({ colorMode: 'light' });
    const { result } = renderHook(() => useColorMode());
    expect(result.current.colorMode).toBe('light');
  });

  it('should toggle color mode from light to dark', () => {
    const { result } = renderHook(() => useColorMode());
    
    act(() => {
      result.current.toggleColorMode();
    });
    
    expect(result.current.colorMode).toBe('dark');
    expect(useConfigStore.getState().colorMode).toBe('dark');
  });

  it('should toggle color mode from dark to light', () => {
    useConfigStore.setState({ colorMode: 'dark' });
    const { result } = renderHook(() => useColorMode());
    
    act(() => {
      result.current.toggleColorMode();
    });
    
    expect(result.current.colorMode).toBe('light');
    expect(useConfigStore.getState().colorMode).toBe('light');
  });
});
