import type { components } from "./api.types";

type Market = components["schemas"]["Market"];
type WsSignalEvent = components["schemas"]["WsSignalEvent"];

export const mockMarkets: Market[] = [
  {
    id: "KXETH-25-5K",
    title: "Will Ethereum reach $5k by end of 2025?",
    status: "open",
    yesPrice: 0.85,
    noPrice: 0.15,
    lastUpdated: new Date().toISOString(),
  },
  {
    id: "KXFED-RATE-MAY26",
    title: "Will the Fed cut rates in May 2026?",
    status: "open",
    yesPrice: 0.45,
    noPrice: 0.55,
    lastUpdated: new Date().toISOString(),
  },
  {
    id: "KXAI-AGI-2029",
    title: "Will a general AI achieve AGI by 2029?",
    status: "open",
    yesPrice: 0.32,
    noPrice: 0.68,
    lastUpdated: new Date().toISOString(),
  },
];

export const mockSignals: WsSignalEvent[] = [
  {
    type: "signal_event",
    marketId: "KXETH-25-5K",
    netSignal: 0.62,
    source: "Bloomberg",
    ts: new Date().toISOString(),
  },
  {
    type: "signal_event",
    marketId: "KXFED-RATE-MAY26",
    netSignal: -0.31,
    source: "Reuters",
    ts: new Date().toISOString(),
  },
  {
    type: "signal_event",
    marketId: "KXAI-AGI-2029",
    netSignal: 0.18,
    source: "CoinDesk",
    ts: new Date().toISOString(),
  },
];
