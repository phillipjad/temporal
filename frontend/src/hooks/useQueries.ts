import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../lib/api.client";
import { mockMarkets } from "../lib/mockData";

export function useMarkets() {
  return useQuery({
    queryKey: ["markets"],
    queryFn: async () => {
      try {
        const { data, error } = await apiClient.GET("/api/v1/markets");
        if (error) throw new Error("Failed to fetch markets");
        return data || [];
      } catch (err) {
        console.warn("Backend unavailable, using mock markets...", err);
        return mockMarkets;
      }
    },
  });
}

export function useSystemConfig() {
  return useQuery({
    queryKey: ["systemConfig"],
    queryFn: async () => {
      try {
        const { data, error } = await apiClient.GET("/api/v1/config");
        if (error) throw new Error("Failed to fetch system config");
        return data || { autoTradingSystemEnabled: false };
      } catch (err) {
        console.warn("Backend unavailable, using mock config...", err);
        return { autoTradingSystemEnabled: false };
      }
    },
  });
}
