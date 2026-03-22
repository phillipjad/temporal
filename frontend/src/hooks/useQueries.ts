import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { components } from "../lib/api.types";
import { apiClient } from "../lib/api.client";
import { mockMarkets } from "../lib/mockData";

type Market = components["schemas"]["Market"];
type UserConfig = components["schemas"]["UserConfig"];

const defaultUserConfig: UserConfig = {
  autoTradingEnabled: false,
  maxRiskPerTrade: 0,
  maxDailyLoss: 0,
  maxOpenPositions: 1,
  buyThreshold: 0,
  sellThreshold: 0,
  signalDecayHalfLifeSecs: 0,
};

export function useMarkets(): UseQueryResult<Market[]> {
  return useQuery<Market[]>({
    queryKey: ["markets"],
    queryFn: async (): Promise<Market[]> => {
      try {
        const { data, error } = await apiClient.GET("/api/v1/markets");
        if (error) throw new Error("Failed to fetch markets");
        return data ?? [];
      } catch (err) {
        console.warn("Backend unavailable, using mock markets...", err);
        return mockMarkets;
      }
    },
  });
}

export function useSystemConfig(): UseQueryResult<UserConfig> {
  return useQuery<UserConfig>({
    queryKey: ["systemConfig"],
    queryFn: async (): Promise<UserConfig> => {
      try {
        const { data, error } = await apiClient.GET("/api/v1/config");
        if (error) throw new Error("Failed to fetch system config");
        return data ?? defaultUserConfig;
      } catch (err) {
        console.warn("Backend unavailable, using mock config...", err);
        return defaultUserConfig;
      }
    },
  });
}
