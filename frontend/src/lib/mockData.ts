import type { components } from "./api.types";
type Market = components["schemas"]["Market"];
type NewsEvent = components["schemas"]["NewsEvent"];

export const mockMarkets: Market[] = [
  { id: "MKT-1", question: "Will Ethereum reach $5k by end of year?", confidenceScore: 0.85 },
  { id: "MKT-2", question: "Will the Fed cut rates in May 2026?", confidenceScore: 0.45 },
  { id: "MKT-3", question: "Will generic AI achieve AGI by 2029?", confidenceScore: 0.65 }
];

export const mockNews: NewsEvent[] = [
  { id: "N-1", source: "Bloomberg", title: "Federal Reserve signals potential rate cut ahead" },
  { id: "N-2", source: "Reuters", title: "Tech stocks rally as AI models show unprecedented benchmark results" },
  { id: "N-3", source: "CoinDesk", title: "Ethereum validators see record staking yields this quarter" }
];
