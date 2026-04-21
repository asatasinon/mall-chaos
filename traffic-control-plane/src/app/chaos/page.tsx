'use client';

import { useState } from 'react';

const CHAOS_TYPES = [
  {
    title: 'Slow SQL',
    type: 'slow-sql',
    enablePath: '/internal/traffic/chaos/slow-sql/enable',
    disablePath: '/internal/traffic/chaos/slow-sql/disable',
    statusPath: '/internal/traffic/chaos/slow-sql/status',
    defaultBody: {
      targets: ['order-service', 'payment-service'],
      mode: 'real',
      delayMs: 3000,
      injectRate: 1.0,
      scope: 'ALL',
      durationSec: 300,
    },
  },
  {
    title: 'Memory Leak',
    type: 'memory-leak',
    enablePath: '/internal/traffic/chaos/memory-leak/enable',
    disablePath: '/internal/traffic/chaos/memory-leak/disable',
    statusPath: '/internal/traffic/chaos/memory-leak/status',
    cleanupPath: '/internal/traffic/chaos/memory-leak/cleanup',
    defaultBody: {
      targets: ['order-service'],
      chunkSizeKb: 512,
      intervalMs: 500,
      maxMb: 256,
      durationSec: 300,
    },
  },
  {
    title: 'Deadlock',
    type: 'deadlock',
    enablePath: '/internal/traffic/chaos/deadlock/enable',
    disablePath: '/internal/traffic/chaos/deadlock/disable',
    statusPath: '/internal/traffic/chaos/deadlock/status',
    cleanupPath: '/internal/traffic/chaos/deadlock/cleanup',
    defaultBody: {
      targets: ['payment-service'],
      injectRate: 0.5,
      scope: 'ALL',
      durationSec: 300,
    },
  },
  {
    title: 'Table Lock',
    type: 'table-lock',
    enablePath: '/internal/traffic/chaos/table-lock/enable',
    disablePath: '/internal/traffic/chaos/table-lock/disable',
    statusPath: '/internal/traffic/chaos/table-lock/status',
    defaultBody: {
      targetService: 'order-service',
      targetTable: 'orders',
      durationSec: 300,
    },
  },
  {
    title: 'Network Delay',
    type: 'network-delay',
    enablePath: '/internal/traffic/chaos/network-delay/enable',
    disablePath: '/internal/traffic/chaos/network-delay/disable',
    statusPath: '/internal/traffic/chaos/network-delay/status',
    defaultBody: {
      proxyName: 'order-to-payment',
      latencyMs: 5000,
      jitter: 2000,
    },
  },
  {
    title: 'Network Reset',
    type: 'network-reset',
    enablePath: '/internal/traffic/chaos/network-reset/enable',
    disablePath: '/internal/traffic/chaos/network-reset/disable',
    statusPath: '/internal/traffic/chaos/network-reset/status',
    defaultBody: {
      proxyName: 'order-to-payment',
      latencyMs: 0,
      jitter: 0,
    },
  },
];

export default function ChaosControlPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Chaos Control</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {CHAOS_TYPES.map((ct) => (
          <ChaosCard key={ct.type} config={ct} />
        ))}
      </div>
    </div>
  );
}

function ChaosCard({ config }: { config: typeof CHAOS_TYPES[0] }) {
  const [status, setStatus] = useState<string>('idle');
  const [result, setResult] = useState<string | null>(null);

  const action = async (path: string, body?: unknown) => {
    setStatus('loading');
    try {
      const res = await fetch(path, {
        method: path.endsWith('/status') ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json();
      setResult(JSON.stringify(json.data, null, 2));
      setStatus('done');
    } catch (e: any) {
      setResult(e.message);
      setStatus('error');
    }
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-400 mb-3">{config.title}</h3>
      <div className="flex gap-2 mb-3 flex-wrap">
        <button onClick={() => action(config.enablePath, config.defaultBody)}
                className="px-3 py-1.5 bg-red-700 hover:bg-red-600 rounded text-xs">Enable</button>
        <button onClick={() => action(config.disablePath, config.type === 'table-lock' ? config.defaultBody : config.type.startsWith('network-') ? { proxyName: (config.defaultBody as any).proxyName } : {})}
                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs">Disable</button>
        {'cleanupPath' in config && config.cleanupPath && (
          <button onClick={() => action(config.cleanupPath!, {})}
                  className="px-3 py-1.5 bg-amber-700 hover:bg-amber-600 rounded text-xs">Cleanup</button>
        )}
        <button onClick={() => {
          const statusPath = config.type === 'table-lock'
            ? `${config.statusPath}?targetService=${(config.defaultBody as any).targetService}&targetTable=${(config.defaultBody as any).targetTable}`
            : config.type.startsWith('network-')
              ? `${config.statusPath}?proxyName=${(config.defaultBody as any).proxyName}`
              : config.statusPath;
          action(statusPath);
        }}
                className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 rounded text-xs">Status</button>
      </div>
      {result && (
        <pre className="text-xs text-gray-400 bg-gray-950 rounded p-2 max-h-32 overflow-auto whitespace-pre-wrap">
          {result}
        </pre>
      )}
    </div>
  );
}
