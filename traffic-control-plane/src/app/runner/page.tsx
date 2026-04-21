'use client';

import { useEffect, useState } from 'react';

interface RunnerStatus {
  running: boolean;
  paused: boolean;
  currentQps: number;
  successRate: number;
  failRate: number;
  totalRequests: number;
  rateMultiplier: number;
}

interface RunnerConfig {
  version: number;
  baseQps: number;
  peakMultiplier: number;
  cycleMinutes: number;
  jitterPct: number;
}

export default function RunnerPage() {
  const [status, setStatus] = useState<RunnerStatus | null>(null);
  const [config, setConfig] = useState<RunnerConfig | null>(null);
  const [multiplier, setMultiplier] = useState('1.0');

  useEffect(() => {
    const load = async () => {
      try {
        const [sRes, cRes] = await Promise.all([
          fetch('/internal/traffic/runner/status'),
          fetch('/internal/traffic/runner/config'),
        ]);
        const sJson = await sRes.json();
        const cJson = await cRes.json();
        if (sJson.code === 0) setStatus(sJson.data);
        if (cJson.code === 0) setConfig(cJson.data);
      } catch {}
    };
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, []);

  const action = async (path: string, body?: unknown) => {
    await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Runner Control</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">Traffic Status</h3>
          {status ? (
            <div className="space-y-2 text-sm">
              <Stat label="Status" value={status.paused ? 'Paused' : status.running ? 'Running' : 'Stopped'}
                    color={status.running && !status.paused ? 'text-green-400' : 'text-yellow-400'} />
              <Stat label="QPS" value={String(status.currentQps)} />
              <Stat label="Success" value={`${(status.successRate * 100).toFixed(1)}%`} />
              <Stat label="Fail" value={`${(status.failRate * 100).toFixed(1)}%`} />
              <Stat label="Total" value={status.totalRequests.toLocaleString()} />
              <Stat label="Multiplier" value={`${status.rateMultiplier}x`} />
            </div>
          ) : (
            <p className="text-xs text-gray-500">Loading...</p>
          )}
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">Controls</h3>
          <div className="flex gap-2 mb-4">
            <button onClick={() => action('/internal/traffic/runner/resume')}
                    className="px-3 py-1.5 bg-green-700 hover:bg-green-600 rounded text-xs">Resume</button>
            <button onClick={() => action('/internal/traffic/runner/pause')}
                    className="px-3 py-1.5 bg-yellow-700 hover:bg-yellow-600 rounded text-xs">Pause</button>
          </div>
          <div className="flex gap-2 items-center">
            <input type="number" step="0.1" min="0.1" max="10" value={multiplier}
                   onChange={(e) => setMultiplier(e.target.value)}
                   className="w-20 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs" />
            <button onClick={() => action('/internal/traffic/runner/rate', { multiplier: parseFloat(multiplier) })}
                    className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 rounded text-xs">Set Rate</button>
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 md:col-span-2">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">Configuration</h3>
          {config ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <Stat label="Version" value={String(config.version)} />
              <Stat label="Base QPS" value={String(config.baseQps)} />
              <Stat label="Peak Multiplier" value={`${config.peakMultiplier}x`} />
              <Stat label="Cycle" value={`${config.cycleMinutes} min`} />
              <Stat label="Jitter" value={`${(config.jitterPct * 100).toFixed(0)}%`} />
            </div>
          ) : (
            <p className="text-xs text-gray-500">Loading...</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className={`font-mono ${color || 'text-white'}`}>{value}</span>
    </div>
  );
}
