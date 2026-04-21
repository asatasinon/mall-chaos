'use client';

import { useEffect, useState } from 'react';

interface OverviewData {
  runner: {
    running: boolean;
    paused: boolean;
    currentQps: number;
    successRate: number;
    failRate: number;
    totalRequests: number;
  };
  chaos: Record<string, unknown>;
  timestamp: string;
}

export default function OverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/internal/traffic/chaos/overview');
        const json = await res.json();
        if (json.code === 0) setData(json.data);
        else setError(json.message);
      } catch (e: any) {
        setError(e.message);
      }
    };
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  if (error) return <div className="text-red-400">Error: {error}</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Overview</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-400 mb-2">Runner</h3>
          {data ? (
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Status</span>
                <span className={data.runner.running ? 'text-green-400' : 'text-red-400'}>
                  {data.runner.paused ? 'Paused' : data.runner.running ? 'Running' : 'Stopped'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">QPS</span>
                <span className="text-white font-mono">{data.runner.currentQps}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Success Rate</span>
                <span className="text-white font-mono">{(data.runner.successRate * 100).toFixed(1)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Total Requests</span>
                <span className="text-white font-mono">{data.runner.totalRequests.toLocaleString()}</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-500">Loading...</p>
          )}
        </div>

        {data && Object.entries(data.chaos).map(([key, value]) => (
          <div key={key} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-400 mb-2">{formatChaosName(key)}</h3>
            <ChaosStatusDisplay data={value} />
          </div>
        ))}
      </div>
      {data && (
        <div className="mt-4 text-xs text-gray-600">
          Last updated: {new Date(data.timestamp).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}

function formatChaosName(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
}

function ChaosStatusDisplay({ data }: { data: unknown }) {
  if (!data || typeof data !== 'object') {
    return <p className="text-xs text-gray-500">No data</p>;
  }
  const obj = data as Record<string, unknown>;
  if (obj.error) {
    return <p className="text-xs text-gray-500">Unavailable</p>;
  }
  return (
    <div className="space-y-1 text-xs">
      {Object.entries(obj).map(([k, v]) => (
        <div key={k} className="flex justify-between">
          <span className="text-gray-500">{k}</span>
          <span className="text-gray-300 font-mono truncate ml-2">
            {typeof v === 'object' ? JSON.stringify(v) : String(v)}
          </span>
        </div>
      ))}
    </div>
  );
}
