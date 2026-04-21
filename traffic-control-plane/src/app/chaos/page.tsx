'use client';

import { useState } from 'react';

// ── Service / proxy availability per chaos type (mirrors gateway whitelist config) ──
const SLOW_SQL_TARGETS = [
  'catalog-service', 'inventory-service', 'order-service', 'payment-service',
  'promotion-service', 'risk-service', 'fulfillment-service', 'notification-service',
];
const MEMORY_LEAK_TARGETS = ['order-service', 'payment-service'];
const DEADLOCK_TARGETS = ['order-service', 'payment-service'];
const TABLE_LOCK_SERVICES = ['order-service', 'payment-service', 'fulfillment-service', 'notification-service'];
const TABLES_PER_SERVICE: Record<string, string[]> = {
  'order-service': ['orders', 'order_items'],
  'payment-service': ['payments'],
  'fulfillment-service': ['fulfillments'],
  'notification-service': ['notifications'],
};
const PROXY_NAMES = ['order-to-payment', 'order-to-inventory', 'gateway-to-order'];

export default function ChaosControlPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Chaos Control</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MultiTargetCard
          title="Slow SQL"
          type="slow-sql"
          availableTargets={SLOW_SQL_TARGETS}
          defaultTargets={['order-service', 'payment-service']}
          enablePath="/internal/traffic/chaos/slow-sql/enable"
          disablePath="/internal/traffic/chaos/slow-sql/disable"
          statusPath="/internal/traffic/chaos/slow-sql/status"
          extraParams={[
            {
              key: 'joinTable',
              label: 'JOIN Table',
              type: 'select',
              default: 'user_behavior_log',
              options: ['user_behavior_log', 'product_price_history'],
            },
            { key: 'limitRows', label: 'LIMIT', type: 'number', default: '1', min: '1' },
            { key: 'offsetRows', label: 'OFFSET', type: 'number', default: '200000', min: '0' },
            { key: 'durationSec', label: 'Duration (s)', type: 'number', default: '300' },
          ]}
        />
        <MultiTargetCard
          title="Memory Leak"
          type="memory-leak"
          availableTargets={MEMORY_LEAK_TARGETS}
          defaultTargets={['order-service']}
          enablePath="/internal/traffic/chaos/memory-leak/enable"
          disablePath="/internal/traffic/chaos/memory-leak/disable"
          statusPath="/internal/traffic/chaos/memory-leak/status"
          cleanupPath="/internal/traffic/chaos/memory-leak/cleanup"
          extraParams={[
            { key: 'chunkSizeKb', label: 'Chunk (KB)', type: 'number', default: '512' },
            { key: 'intervalMs', label: 'Interval (ms)', type: 'number', default: '500' },
          ]}
        />
        <MultiTargetCard
          title="Deadlock"
          type="deadlock"
          availableTargets={DEADLOCK_TARGETS}
          defaultTargets={['payment-service']}
          enablePath="/internal/traffic/chaos/deadlock/enable"
          disablePath="/internal/traffic/chaos/deadlock/disable"
          statusPath="/internal/traffic/chaos/deadlock/status"
          cleanupPath="/internal/traffic/chaos/deadlock/cleanup"
          extraParams={[
            { key: 'injectRate', label: 'Inject Rate', type: 'number', default: '0.5', step: '0.1', min: '0', max: '1' },
            { key: 'durationSec', label: 'Duration (s)', type: 'number', default: '300' },
          ]}
          fixedParams={{ scope: 'ALL' }}
        />
        <TableLockCard
          title="Table Lock"
          enablePath="/internal/traffic/chaos/table-lock/enable"
          disablePath="/internal/traffic/chaos/table-lock/disable"
          statusPath="/internal/traffic/chaos/table-lock/status"
          availableServices={TABLE_LOCK_SERVICES}
          tablesPerService={TABLES_PER_SERVICE}
        />
        <NetworkCard
          title="Network Delay"
          enablePath="/internal/traffic/chaos/network-delay/enable"
          disablePath="/internal/traffic/chaos/network-delay/disable"
          statusPath="/internal/traffic/chaos/network-delay/status"
          availableProxies={PROXY_NAMES}
          extraParams={[
            { key: 'latencyMs', label: 'Latency (ms)', default: '5000' },
            { key: 'jitter', label: 'Jitter (ms)', default: '2000' },
          ]}
        />
        <NetworkCard
          title="Network Reset"
          enablePath="/internal/traffic/chaos/network-reset/enable"
          disablePath="/internal/traffic/chaos/network-reset/disable"
          statusPath="/internal/traffic/chaos/network-reset/status"
          availableProxies={PROXY_NAMES}
          extraParams={[]}
          fixedParams={{ latencyMs: 0, jitter: 0 }}
        />
      </div>
    </div>
  );
}

// ── Shared result display ──
function ResultBox({ result }: { result: string | null }) {
  if (!result) return null;
  return (
    <pre className="mt-3 text-xs text-gray-400 bg-gray-950 rounded p-2 max-h-32 overflow-auto whitespace-pre-wrap border border-gray-800">
      {result}
    </pre>
  );
}

function ActionButtons({
  onEnable, onDisable, onCleanup, onStatus, loading,
}: {
  onEnable: () => void; onDisable: () => void;
  onCleanup?: () => void; onStatus: () => void;
  loading: boolean;
}) {
  return (
    <div className="flex gap-2 flex-wrap">
      <button onClick={onEnable} disabled={loading}
              className="px-3 py-1.5 bg-red-700 hover:bg-red-600 disabled:opacity-50 rounded text-xs">Enable</button>
      <button onClick={onDisable} disabled={loading}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded text-xs">Disable</button>
      {onCleanup && (
        <button onClick={onCleanup} disabled={loading}
                className="px-3 py-1.5 bg-amber-700 hover:bg-amber-600 disabled:opacity-50 rounded text-xs">Cleanup</button>
      )}
      <button onClick={onStatus} disabled={loading}
              className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 rounded text-xs">Status</button>
    </div>
  );
}

// ── Multi-target chaos card (slow-sql, memory-leak, deadlock) ──
interface ParamDef {
  key: string;
  label: string;
  type?: string;
  default: string;
  step?: string;
  min?: string;
  max?: string;
  options?: string[];
}

function MultiTargetCard({
  title, availableTargets, defaultTargets,
  enablePath, disablePath, statusPath, cleanupPath,
  extraParams = [], fixedParams = {},
}: {
  title: string; type: string;
  availableTargets: string[]; defaultTargets: string[];
  enablePath: string; disablePath: string; statusPath: string; cleanupPath?: string;
  extraParams?: ParamDef[]; fixedParams?: Record<string, unknown>;
}) {
  const [selectedTargets, setSelectedTargets] = useState<string[]>(defaultTargets);
  const [params, setParams] = useState<Record<string, string>>(
    Object.fromEntries(extraParams.map((p) => [p.key, p.default]))
  );
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const toggleTarget = (t: string) =>
    setSelectedTargets((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);

  const call = async (path: string, body?: unknown) => {
    setLoading(true);
    try {
      const method = path.endsWith('/status') ? 'GET' : 'POST';
      const res = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const json = await res.json();
      setResult(JSON.stringify(json.data ?? json, null, 2));
    } catch (e: any) {
      setResult(e.message);
    } finally {
      setLoading(false);
    }
  };

  const buildBody = () => ({
    targets: selectedTargets,
    ...fixedParams,
    ...Object.fromEntries(extraParams.map((p) => [p.key, p.type === 'number' ? parseFloat(params[p.key]) : params[p.key]])),
  });

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">{title}</h3>

      {/* Service selector */}
      <div className="mb-3">
        <p className="text-xs text-gray-500 mb-1.5">Target services</p>
        <div className="flex flex-wrap gap-1.5">
          {availableTargets.map((t) => (
            <button key={t} onClick={() => toggleTarget(t)}
                    className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                      selectedTargets.includes(t)
                        ? 'bg-amber-700/30 border-amber-600 text-amber-300'
                        : 'bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-500'
                    }`}>
              {t.replace('-service', '')}
            </button>
          ))}
        </div>
      </div>

      {/* Extra params */}
      {extraParams.length > 0 && (
        <div className="grid grid-cols-2 gap-2 mb-3">
          {extraParams.map((p) => (
            <div key={p.key} className="flex flex-col gap-0.5">
              <label className="text-xs text-gray-500">{p.label}</label>
              {p.type === 'select' ? (
                <select
                  value={params[p.key]}
                  onChange={(e) => setParams((prev) => ({ ...prev, [p.key]: e.target.value }))}
                  className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs"
                >
                  {(p.options ?? []).map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <input type={p.type ?? 'text'} step={p.step} min={p.min} max={p.max}
                       value={params[p.key]}
                       onChange={(e) => setParams((prev) => ({ ...prev, [p.key]: e.target.value }))}
                       className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs font-mono" />
              )}
            </div>
          ))}
        </div>
      )}

      <ActionButtons
        loading={loading}
        onEnable={() => call(enablePath, buildBody())}
        onDisable={() => call(disablePath, { targets: selectedTargets })}
        onCleanup={cleanupPath ? () => call(cleanupPath, { targets: selectedTargets }) : undefined}
        onStatus={() => call(statusPath)}
      />
      <ResultBox result={result} />
    </div>
  );
}

// ── Table lock card ──
function TableLockCard({
  title, enablePath, disablePath, statusPath, availableServices, tablesPerService,
}: {
  title: string;
  enablePath: string; disablePath: string; statusPath: string;
  availableServices: string[]; tablesPerService: Record<string, string[]>;
}) {
  const [service, setService] = useState(availableServices[0]);
  const [table, setTable] = useState(tablesPerService[availableServices[0]]?.[0] ?? '');
  const [durationSec, setDurationSec] = useState('300');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleServiceChange = (s: string) => {
    setService(s);
    setTable(tablesPerService[s]?.[0] ?? '');
  };

  const call = async (path: string, body?: unknown) => {
    setLoading(true);
    try {
      const isGet = path.includes('/status');
      const url = isGet ? `${path}?targetService=${service}&targetTable=${table}` : path;
      const res = await fetch(url, {
        method: isGet ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: !isGet && body !== undefined ? JSON.stringify(body) : undefined,
      });
      const json = await res.json();
      setResult(JSON.stringify(json.data ?? json, null, 2));
    } catch (e: any) {
      setResult(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">{title}</h3>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="flex flex-col gap-0.5">
          <label className="text-xs text-gray-500">Target service</label>
          <select value={service} onChange={(e) => handleServiceChange(e.target.value)}
                  className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs">
            {availableServices.map((s) => (
              <option key={s} value={s}>{s.replace('-service', '')}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-0.5">
          <label className="text-xs text-gray-500">Target table</label>
          <select value={table} onChange={(e) => setTable(e.target.value)}
                  className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs">
            {(tablesPerService[service] ?? []).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-0.5">
          <label className="text-xs text-gray-500">Duration (s)</label>
          <input type="number" min="10" value={durationSec} onChange={(e) => setDurationSec(e.target.value)}
                 className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs font-mono" />
        </div>
      </div>
      <ActionButtons
        loading={loading}
        onEnable={() => call(enablePath, { targetService: service, targetTable: table, durationSec: parseInt(durationSec, 10) })}
        onDisable={() => call(disablePath, { targetService: service, targetTable: table })}
        onStatus={() => call(statusPath)}
      />
      <ResultBox result={result} />
    </div>
  );
}

// ── Network chaos card ──
function NetworkCard({
  title, enablePath, disablePath, statusPath, availableProxies, extraParams = [], fixedParams = {},
}: {
  title: string;
  enablePath: string; disablePath: string; statusPath: string;
  availableProxies: string[];
  extraParams?: { key: string; label: string; default: string }[];
  fixedParams?: Record<string, unknown>;
}) {
  const [proxyName, setProxyName] = useState(availableProxies[0]);
  const [params, setParams] = useState<Record<string, string>>(
    Object.fromEntries(extraParams.map((p) => [p.key, p.default]))
  );
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const call = async (path: string, body?: unknown) => {
    setLoading(true);
    try {
      const isGet = path.includes('/status');
      const url = isGet ? `${path}?proxyName=${proxyName}` : path;
      const res = await fetch(url, {
        method: isGet ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: !isGet && body !== undefined ? JSON.stringify(body) : undefined,
      });
      const json = await res.json();
      setResult(JSON.stringify(json.data ?? json, null, 2));
    } catch (e: any) {
      setResult(e.message);
    } finally {
      setLoading(false);
    }
  };

  const buildBody = () => ({
    proxyName,
    ...fixedParams,
    ...Object.fromEntries(extraParams.map((p) => [p.key, parseInt(params[p.key], 10)])),
  });

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">{title}</h3>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="flex flex-col gap-0.5 col-span-2">
          <label className="text-xs text-gray-500">Proxy</label>
          <select value={proxyName} onChange={(e) => setProxyName(e.target.value)}
                  className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs">
            {availableProxies.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        {extraParams.map((p) => (
          <div key={p.key} className="flex flex-col gap-0.5">
            <label className="text-xs text-gray-500">{p.label}</label>
            <input type="number" value={params[p.key]}
                   onChange={(e) => setParams((prev) => ({ ...prev, [p.key]: e.target.value }))}
                   className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs font-mono" />
          </div>
        ))}
      </div>
      <ActionButtons
        loading={loading}
        onEnable={() => call(enablePath, buildBody())}
        onDisable={() => call(disablePath, { proxyName })}
        onStatus={() => call(statusPath)}
      />
      <ResultBox result={result} />
    </div>
  );
}
