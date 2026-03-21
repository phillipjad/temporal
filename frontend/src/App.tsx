import React, { useEffect } from 'react';
import { useConfigStore } from './stores/useConfigStore';
import { useCircularBuffer } from './hooks/useCircularBuffer';
import { useWs } from './hooks/useWs';
import { useMarkets, useSystemConfig } from './hooks/useQueries';
import { AutoTradingToggle } from './components/AutoTradingToggle';
import type { components } from './lib/api.types';

type NewsEvent = components['schemas']['NewsEvent'];

export default function App() {
  const { uiVisibility, activeFilter, setUiVisibility, setActiveFilter } = useConfigStore();
  const { data: markets = [], isLoading: loadingMarkets } = useMarkets();
  const { data: systemConfig, isLoading: loadingConfig } = useSystemConfig();
  const { buffer: newsFeed, push: pushNews } = useCircularBuffer<NewsEvent>(50);

  useWs('ws://localhost:8080/ws');

  useEffect(() => {
    const handleNews = (e: Event) => {
      const customEvent = e as CustomEvent<NewsEvent[]>;
      pushNews(customEvent.detail);
    };
    window.addEventListener('temporal:news_event', handleNews);
    return () => window.removeEventListener('temporal:news_event', handleNews);
  }, [pushNews]);

  const toggleAutoTrading = async (status: boolean) => {
    console.log(`Setting system auto-trading to: ${status}`);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-8">
      <div className="max-w-6xl mx-auto space-y-8 text-left">
        <header className="flex justify-between items-center border-b border-gray-200 dark:border-gray-800 pb-4">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">Temporal AI</h1>
            <p className="text-gray-500 mt-2">Automated prediction market trading, driven by news.</p>
          </div>
          <div>
            <button 
              onClick={() => setUiVisibility(!uiVisibility)}
              className="px-3 py-1 bg-gray-200 dark:bg-gray-800 rounded mb-2 text-sm"
            >
              {uiVisibility ? "Hide Controls" : "Show Controls"}
            </button>
          </div>
        </header>

        {uiVisibility && (
          <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 space-y-4">
              <h2 className="text-2xl font-semibold">Active Markets & Confidence</h2>
              
              {loadingMarkets ? (
                <div className="p-4 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse h-24"></div>
              ) : markets.length === 0 ? (
                <div className="p-4 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 text-gray-500">
                  No active markets found...
                </div>
              ) : (
                <div className="grid gap-4">
                  {markets.map((market) => (
                    <div key={market.id} className="p-4 bg-white dark:bg-gray-800 rounded shadow-sm border border-gray-200 dark:border-gray-700 flex justify-between items-center">
                      <div>
                        <span className="text-xs font-mono text-gray-400 block mb-1">{market.id}</span>
                        <h3 className="font-medium text-lg leading-tight">{market.question}</h3>
                      </div>
                      <div className="text-right pl-4">
                        <div className={`text-2xl font-bold ${(market.confidenceScore ?? 0) > 0.8 ? 'text-green-500' : 'text-blue-500'}`}>
                          {((market.confidenceScore ?? 0) * 100).toFixed(1)}%
                        </div>
                        <span className="text-xs text-gray-500 uppercase tracking-widest">Confidence</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-4">
              <h2 className="text-2xl font-semibold">Risk Engine</h2>
              {loadingConfig ? (
                <div className="p-4 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse h-32"></div>
              ) : (
                <AutoTradingToggle 
                  currentStatus={systemConfig?.autoTradingSystemEnabled ?? false} 
                  onToggle={toggleAutoTrading} 
                />
              )}
              
              <div className="mt-8 p-4 bg-gray-100 dark:bg-gray-800 rounded">
                <h3 className="font-medium mb-2 text-sm uppercase text-gray-500">Live News Feed</h3>
                <div className="mb-3 space-x-2">
                  {['all', 'relevant', 'ignored'].map(filter => (
                    <button 
                      key={filter}
                      onClick={() => setActiveFilter(filter)}
                      className={`text-xs px-2 py-1 rounded ${activeFilter === filter ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}
                    >
                      {filter}
                    </button>
                  ))}
                </div>
                <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
                  {newsFeed.length === 0 ? (
                    <span className="text-sm text-gray-500 italic block py-4 text-center">Waiting for news events...</span>
                  ) : (
                    newsFeed.map(news => (
                      <div key={news.id} className="text-sm p-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded">
                        <span className="text-blue-500 font-semibold">{news.source}</span>
                        <p className="mt-1">{news.title}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
