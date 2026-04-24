'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const SLOW_SQL_TARGETS    = ['catalog-service','inventory-service','order-service','payment-service','promotion-service','risk-service','fulfillment-service','notification-service'];
const MEMORY_LEAK_TARGETS = ['order-service','payment-service'];
const DEADLOCK_TARGETS    = ['order-service','payment-service'];
const TABLE_LOCK_SERVICES = ['order-service','payment-service','fulfillment-service','notification-service'];
const TABLES_PER_SERVICE: Record<string, string[]> = {
  'order-service':        ['orders','order_items'],
  'payment-service':      ['payments'],
  'fulfillment-service':  ['fulfillments'],
  'notification-service': ['notifications'],
};
const PROXY_NAMES = ['order-to-payment','order-to-inventory','gateway-to-order'];

interface ParamDef {
  key: string; label: string; type?: string; default: string;
  step?: string; min?: string; max?: string; options?: string[];
}

type DangerLevel = 'medium' | 'high' | 'critical';

const DANGER_BADGE: Record<DangerLevel, { label: string; cls: string }> = {
  medium:   { label: 'Medium',   cls: 'border-warning/40 text-warning bg-warning/5' },
  high:     { label: 'High',     cls: 'border-destructive/40 text-destructive bg-destructive/5' },
  critical: { label: 'Critical', cls: 'border-destructive/60 text-destructive bg-destructive/10' },
};

export default function ChaosControlPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Chaos Control</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Fault injection — armed and ready</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <MultiTargetCard title="Slow SQL" danger="high"
          availableTargets={SLOW_SQL_TARGETS} defaultTargets={['order-service','payment-service']}
          enablePath="/internal/traffic/chaos/slow-sql/enable"
          disablePath="/internal/traffic/chaos/slow-sql/disable"
          statusPath="/internal/traffic/chaos/slow-sql/status"
          extraParams={[
            { key:'joinTable',  label:'JOIN Table',  type:'select', default:'user_behavior_log', options:['user_behavior_log','product_price_history'] },
            { key:'limitRows',  label:'LIMIT',       type:'number', default:'1',      min:'1' },
            { key:'offsetRows', label:'OFFSET',      type:'number', default:'200000', min:'0' },
            { key:'durationSec',label:'Duration (s)',type:'number', default:'300' },
          ]}
        />
        <MultiTargetCard title="Memory Leak" danger="high"
          availableTargets={MEMORY_LEAK_TARGETS} defaultTargets={['order-service']}
          enablePath="/internal/traffic/chaos/memory-leak/enable"
          disablePath="/internal/traffic/chaos/memory-leak/disable"
          statusPath="/internal/traffic/chaos/memory-leak/status"
          cleanupPath="/internal/traffic/chaos/memory-leak/cleanup"
          extraParams={[
            { key:'chunkSizeKb',label:'Chunk (KB)',   type:'number', default:'512' },
            { key:'intervalMs', label:'Interval (ms)',type:'number', default:'500' },
          ]}
        />
        <MultiTargetCard title="Deadlock Injection" danger="critical"
          availableTargets={DEADLOCK_TARGETS} defaultTargets={['payment-service']}
          enablePath="/internal/traffic/chaos/deadlock/enable"
          disablePath="/internal/traffic/chaos/deadlock/disable"
          statusPath="/internal/traffic/chaos/deadlock/status"
          cleanupPath="/internal/traffic/chaos/deadlock/cleanup"
          extraParams={[
            { key:'injectRate', label:'Inject Rate', type:'number', default:'0.5', step:'0.1', min:'0', max:'1' },
            { key:'durationSec',label:'Duration (s)',type:'number', default:'300' },
          ]}
          fixedParams={{ scope:'ALL' }}
        />
        <TableLockCard title="Table Lock"
          enablePath="/internal/traffic/chaos/table-lock/enable"
          disablePath="/internal/traffic/chaos/table-lock/disable"
          statusPath="/internal/traffic/chaos/table-lock/status"
          availableServices={TABLE_LOCK_SERVICES}
          tablesPerService={TABLES_PER_SERVICE}
        />
        <NetworkCard title="Network Delay" danger="medium"
          enablePath="/internal/traffic/chaos/network-delay/enable"
          disablePath="/internal/traffic/chaos/network-delay/disable"
          statusPath="/internal/traffic/chaos/network-delay/status"
          availableProxies={PROXY_NAMES}
          extraParams={[
            { key:'latencyMs',label:'Latency (ms)',default:'5000' },
            { key:'jitter',   label:'Jitter (ms)', default:'2000' },
          ]}
        />
        <NetworkCard title="Network Reset" danger="high"
          enablePath="/internal/traffic/chaos/network-reset/enable"
          disablePath="/internal/traffic/chaos/network-reset/disable"
          statusPath="/internal/traffic/chaos/network-reset/status"
          availableProxies={PROXY_NAMES}
          extraParams={[]}
          fixedParams={{ latencyMs:0, jitter:0 }}
        />
      </div>
    </div>
  );
}

function ResultOutput({ result }: { result: string | null }) {
  if (!result) return null;
  return (
    <pre className="mt-3 text-xs text-muted-foreground bg-muted/40 rounded-md border border-border px-3 py-2 max-h-28 overflow-auto whitespace-pre-wrap font-mono">
      {result}
    </pre>
  );
}

function ActionRow({ onEnable, onDisable, onCleanup, onStatus, loading }: {
  onEnable: () => void; onDisable: () => void;
  onCleanup?: () => void; onStatus: () => void; loading: boolean;
}) {
  return (
    <div className="flex gap-2 flex-wrap pt-1">
      <Button size="sm" variant="destructive" onClick={onEnable} disabled={loading}>
        Inject
      </Button>
      <Button size="sm" variant="outline" onClick={onDisable} disabled={loading}>
        Disarm
      </Button>
      {onCleanup && (
        <Button size="sm" variant="outline"
          className="border-warning/40 text-warning hover:bg-warning/10"
          onClick={onCleanup} disabled={loading}>
          Cleanup
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={onStatus} disabled={loading} className="ml-auto">
        Status
      </Button>
    </div>
  );
}

function ServiceChips({ targets, selected, onToggle }: {
  targets: string[]; selected: string[]; onToggle: (t: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {targets.map((t) => {
        const active = selected.includes(t);
        return (
          <button key={t} onClick={() => onToggle(t)}
            className={[
              'px-2.5 py-1 rounded-md text-xs font-medium border transition-colors',
              active
                ? 'bg-primary/15 border-primary/50 text-primary'
                : 'bg-muted/30 border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground',
            ].join(' ')}>
            {t.replace('-service', '')}
          </button>
        );
      })}
    </div>
  );
}

function ParamGrid({ params, defs, onChange }: {
  params: Record<string, string>;
  defs: ParamDef[];
  onChange: (key: string, val: string) => void;
}) {
  if (!defs.length) return null;
  return (
    <div className="grid grid-cols-2 gap-3">
      {defs.map((p) => (
        <div key={p.key} className="space-y-1">
          <label className="text-xs text-muted-foreground">{p.label}</label>
          {p.type === 'select' ? (
            <select value={params[p.key]} onChange={(e) => onChange(p.key, e.target.value)}
              className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring">
              {(p.options ?? []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          ) : (
            <input type={p.type ?? 'text'} step={p.step} min={p.min} max={p.max}
              value={params[p.key]} onChange={(e) => onChange(p.key, e.target.value)}
              className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-sm font-mono text-foreground outline-none focus:ring-1 focus:ring-ring" />
          )}
        </div>
      ))}
    </div>
  );
}

function MultiTargetCard({ title, danger, availableTargets, defaultTargets, enablePath, disablePath, statusPath, cleanupPath, extraParams = [], fixedParams = {} }: {
  title: string; danger?: DangerLevel;
  availableTargets: string[]; defaultTargets: string[];
  enablePath: string; disablePath: string; statusPath: string; cleanupPath?: string;
  extraParams?: ParamDef[]; fixedParams?: Record<string, unknown>;
}) {
  const [selected, setSelected] = useState<string[]>(defaultTargets);
  const [params, setParams]     = useState<Record<string, string>>(Object.fromEntries(extraParams.map((p) => [p.key, p.default])));
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState<string | null>(null);

  const call = async (path: string, body?: unknown) => {
    setLoading(true);
    try {
      const isGet = path.endsWith('/status');
      const res = await fetch(path, {
        method: isGet ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const json = await res.json();
      setResult(JSON.stringify(json.data ?? json, null, 2));
    } catch (e: unknown) { setResult(e instanceof Error ? e.message : 'error'); }
    finally { setLoading(false); }
  };

  const buildBody = () => ({
    targets: selected,
    ...fixedParams,
    ...Object.fromEntries(extraParams.map((p) => [p.key, p.type === 'number' ? parseFloat(params[p.key]) : params[p.key]])),
  });

  const d = danger ? DANGER_BADGE[danger] : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center justify-between">
          {title}
          {d && <span className={`text-[10px] px-2 py-0.5 rounded border font-medium ${d.cls}`}>{d.label}</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Target services</p>
          <ServiceChips targets={availableTargets} selected={selected}
            onToggle={(t) => setSelected((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t])} />
        </div>
        <ParamGrid params={params} defs={extraParams}
          onChange={(k, v) => setParams((prev) => ({ ...prev, [k]: v }))} />
        <ActionRow loading={loading}
          onEnable={()   => call(enablePath,  buildBody())}
          onDisable={()  => call(disablePath, { targets: selected })}
          onCleanup={cleanupPath ? () => call(cleanupPath, { targets: selected }) : undefined}
          onStatus={()   => call(statusPath)}
        />
        <ResultOutput result={result} />
      </CardContent>
    </Card>
  );
}

function TableLockCard({ title, enablePath, disablePath, statusPath, availableServices, tablesPerService }: {
  title: string; enablePath: string; disablePath: string; statusPath: string;
  availableServices: string[]; tablesPerService: Record<string, string[]>;
}) {
  const [service, setService]   = useState(availableServices[0]);
  const [table, setTable]       = useState(tablesPerService[availableServices[0]]?.[0] ?? '');
  const [duration, setDuration] = useState('300');
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState<string | null>(null);

  const handleSvc = (s: string) => { setService(s); setTable(tablesPerService[s]?.[0] ?? ''); };

  const call = async (path: string, body?: unknown) => {
    setLoading(true);
    try {
      const isGet = path.includes('/status');
      const url   = isGet ? `${path}?targetService=${service}&targetTable=${table}` : path;
      const res   = await fetch(url, {
        method: isGet ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: !isGet && body !== undefined ? JSON.stringify(body) : undefined,
      });
      const json = await res.json();
      setResult(JSON.stringify(json.data ?? json, null, 2));
    } catch (e: unknown) { setResult(e instanceof Error ? e.message : 'error'); }
    finally { setLoading(false); }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center justify-between">
          {title}
          <span className={`text-[10px] px-2 py-0.5 rounded border font-medium ${DANGER_BADGE.high.cls}`}>High</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Target service" value={service} onChange={handleSvc}
            options={availableServices.map((s) => ({ value: s, label: s.replace('-service', '') }))} />
          <SelectField label="Target table" value={table} onChange={setTable}
            options={(tablesPerService[service] ?? []).map((t) => ({ value: t, label: t }))} />
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Duration (s)</label>
            <input type="number" min="10" value={duration} onChange={(e) => setDuration(e.target.value)}
              className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-sm font-mono text-foreground outline-none focus:ring-1 focus:ring-ring" />
          </div>
        </div>
        <ActionRow loading={loading}
          onEnable={()  => call(enablePath,  { targetService: service, targetTable: table, durationSec: parseInt(duration, 10) })}
          onDisable={()  => call(disablePath, { targetService: service, targetTable: table })}
          onStatus={()  => call(statusPath)}
        />
        <ResultOutput result={result} />
      </CardContent>
    </Card>
  );
}

function NetworkCard({ title, danger, enablePath, disablePath, statusPath, availableProxies, extraParams = [], fixedParams = {} }: {
  title: string; danger?: DangerLevel;
  enablePath: string; disablePath: string; statusPath: string;
  availableProxies: string[];
  extraParams?: { key: string; label: string; default: string }[];
  fixedParams?: Record<string, unknown>;
}) {
  const [proxy, setProxy]     = useState(availableProxies[0]);
  const [params, setParams]   = useState<Record<string, string>>(Object.fromEntries(extraParams.map((p) => [p.key, p.default])));
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState<string | null>(null);

  const call = async (path: string, body?: unknown) => {
    setLoading(true);
    try {
      const isGet = path.includes('/status');
      const url   = isGet ? `${path}?proxyName=${proxy}` : path;
      const res   = await fetch(url, {
        method: isGet ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: !isGet && body !== undefined ? JSON.stringify(body) : undefined,
      });
      const json = await res.json();
      setResult(JSON.stringify(json.data ?? json, null, 2));
    } catch (e: unknown) { setResult(e instanceof Error ? e.message : 'error'); }
    finally { setLoading(false); }
  };

  const buildBody = () => ({
    proxyName: proxy, ...fixedParams,
    ...Object.fromEntries(extraParams.map((p) => [p.key, parseInt(params[p.key], 10)])),
  });

  const d = danger ? DANGER_BADGE[danger] : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center justify-between">
          {title}
          {d && <span className={`text-[10px] px-2 py-0.5 rounded border font-medium ${d.cls}`}>{d.label}</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <SelectField label="Proxy" value={proxy} onChange={setProxy}
          options={availableProxies.map((p) => ({ value: p, label: p }))} />
        {extraParams.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {extraParams.map((p) => (
              <div key={p.key} className="space-y-1">
                <label className="text-xs text-muted-foreground">{p.label}</label>
                <input type="number" value={params[p.key]} onChange={(e) => setParams((prev) => ({ ...prev, [p.key]: e.target.value }))}
                  className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-sm font-mono text-foreground outline-none focus:ring-1 focus:ring-ring" />
              </div>
            ))}
          </div>
        )}
        <ActionRow loading={loading}
          onEnable={()  => call(enablePath,  buildBody())}
          onDisable={()  => call(disablePath, { proxyName: proxy })}
          onStatus={()  => call(statusPath)}
        />
        <ResultOutput result={result} />
      </CardContent>
    </Card>
  );
}

function SelectField({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
