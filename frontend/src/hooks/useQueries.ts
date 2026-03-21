import { useQuery } from "@tanstack/react-query";
import { apiClient } from "./api.client";

export function useMarkets() {
  return useQuery({
    queryKey: ["markets"],
    queryFn: async () => {
      // openapi-fetch syntax
      const { data, error } = await apiClient.GET("/api/markets");
      if (error) throw new Error("Failed to fetch markets");
      return data || [];
    },
  });
}

export function useSystemConfig() {
  return useQuery({
    queryKey: ["systemConfig"],
    queryFn: async () => {
      const { data, error } = await apiClient.GET("/api/system/config");
      if (error) throw new Error("Failed to fetch system config");
      return data || { autoTradingSystemEnabled: false };
    },
  });
}
