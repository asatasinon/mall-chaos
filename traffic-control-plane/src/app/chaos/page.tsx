'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

// ── Constants ────────────────────────────────────────────────────────────────

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

type DangerLevel = 'medium' | 'high' | 'critical';

const DANGER: Record<DangerLevel, { label: string; cls: string }> = {
  medium:   { label: 'Medium',   cls: 'border-warning/40 text-warning bg-warning/5' },
  high:     { label: 'High',     cls: 'border-destructive/40 text-destructive bg-destructive/5' },
  critical: { label: 'Critical', cls: 'border-destructive/60 text-destructive bg-destructive/10' },
};

interface ParamDef {
  key: string; label: string; type?: string; default: string;
  step?: string; min?: string; max?: string; options?: string[];
}

// ── Chaos registry ────────────────────────────────────────────────────────────

type ChaosId = 'slow-sql' | 'memory-leak' | 'deadlock' | 'table-lock' | 'network-delay' | 'network-reset';

const CHAOS_LIST: { id: ChaosId; label: string; danger: DangerLevel; statusPath: string }[] = [
  { id: 'slow-sql',      label: 'Slow SQL',       danger: 'high',     statusPath: '/internal/traffic/chaos/slow-sql/status' },
  { id: 'memory-leak',   label: 'Memory Leak',    danger: 'high',     statusPath: '/internal/traffic/chaos/memory-leak/status' },
  { id: 'deadlock',      label: 'Deadlock',       danger: 'critical', statusPath: '/internal/traffic/chaos/deadlock/status' },
  { id: 'table-lock',    label: 'Table Lock',     danger: 'high',     statusPath: '/internal/traffic/chaos/table-lock/status' },
  { id: 'network-delay', label: 'Network Delay',  danger: 'medium',   statusPath: '/internal/traffic/chaos/network-delay/status' },
  { id: 'network-reset', label: 'Network Reset',  danger: 'high',     statusPath: '/internal/traffic/chaos/network-reset/status' },
];

// ── Hooks ────────────────────────────────────────────────────────────────────

function useArmedStatus() {
  const [armed, setArmed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const poll = async () => {
      const results = await Promise.allSettled(
        CHAOS_LIST.map(async (c) => {
          const res  = await fetch(c.statusPath);
          const json = await res.json();
          const d    = json.data ?? {};
          return { id: c.id, active: d.enabled === true || d.active === true };
        })
      );
      const next: Record<string, boolean> = {};
      results.forEach((r) => { if (r.status === 'fulfilled') next[r.value.id] = r.value.active; });
      setArmed(next);
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, []);

  return armed;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ChaosControlPage() {
  const [selected, setSelected] = useState<ChaosId>('slow-sql');
  const armed = useArmedStatus();

  const armedCount = Object.values(armed).filter(Boolean).length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Chaos Control</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Fault injection — armed and ready</p>
      </div>

      {/* Active chaos banner */}
      {armedCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
          <span className="text-[11px] font-medium text-destructive/70 shrink-0">Active:</span>
          {CHAOS_LIST.filter((c) => armed[c.id]).map((c) => (
            <button
              key={c.id}
              onClick={() => setSelected(c.id)}
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-destructive/10 border border-destructive/30 text-destructive hover:bg-destructive/20 transition-colors"
            >
              <span className="status-dot status-dot-red" style={{ width: 6, height: 6 }} />
              {c.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-[200px_1fr] border border-border rounded-lg overflow-hidden" style={{ height: 'calc(100vh - 190px)' }}>
        {/* Sidebar */}
        <nav className="border-r border-border flex flex-col overflow-y-auto bg-muted/20">
          {CHAOS_LIST.map((c) => {
            const isActive = selected === c.id;
            const isArmed  = armed[c.id];
            const d = DANGER[c.danger];
            return (
              <button
                key={c.id}
                onClick={() => setSelected(c.id)}
                className={[
                  'relative text-left px-4 py-3.5 border-b border-border/50 transition-colors',
                  isActive
                    ? 'bg-background text-foreground'
                    : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                ].join(' ')}
              >
                {isActive && <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary" />}
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-sm font-medium">{c.label}</span>
                  {isArmed && <span className="status-dot status-dot-red" style={{ width: 7, height: 7 }} />}
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${d.cls}`}>{d.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Detail panel */}
        <div className="overflow-y-auto bg-background p-6">
          {selected === 'slow-sql'      && <SlowSqlPanel    armed={armed['slow-sql']} />}
          {selected === 'memory-leak'   && <MemoryLeakPanel armed={armed['memory-leak']} />}
          {selected === 'deadlock'      && <DeadlockPanel   armed={armed['deadlock']} />}
          {selected === 'table-lock'    && <TableLockPanel  armed={armed['table-lock']} />}
          {selected === 'network-delay' && <NetworkDelayPanel armed={armed['network-delay']} />}
          {selected === 'network-reset' && <NetworkResetPanel armed={armed['network-reset']} />}
        </div>
      </div>
    </div>
  );
}

// ── Shared panel primitives ───────────────────────────────────────────────────

function PanelHeader({ title, danger, armed }: { title: string; danger: DangerLevel; armed?: boolean }) {
  const d = DANGER[danger];
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          {armed ? 'Injecting fault' : 'Standby — not injecting'}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {armed && (
          <Badge variant="destructive" className="text-[10px] gap-1.5">
            <span className="status-dot status-dot-red" style={{ width: 6, height: 6 }} />
            Armed
          </Badge>
        )}
        <span className={`text-[10px] px-2 py-0.5 rounded border font-medium ${d.cls}`}>{d.label}</span>
      </div>
    </div>
  );
}

function MultiSelectCombobox({ options, selected, onChange }: {
  options: string[]; selected: string[]; onChange: (v: string[]) => void;
}) {
  const [open, setOpen]   = useState(false);
  const [input, setInput] = useState('');
  const filtered = options.filter((o) => o.includes(input) && !selected.includes(o));

  const remove = (t: string) => onChange(selected.filter((s) => s !== t));
  const add    = (t: string) => { onChange([...selected, t]); setInput(''); };

  return (
    <div className="space-y-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 items-center">
          {selected.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-primary/15 border border-primary/40 text-primary">
              {t.replace('-service', '')}
              <button onClick={() => remove(t)} className="hover:text-destructive transition-colors leading-none">×</button>
            </span>
          ))}
          <button onClick={() => onChange([])} className="text-[11px] text-muted-foreground hover:text-destructive underline underline-offset-2 transition-colors ml-1">
            Clear all
          </button>
        </div>
      )}
      <div className="relative">
        <input
          value={input}
          onChange={(e) => { setInput(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Add service…"
          className="w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
        />
        {open && filtered.length > 0 && (
          <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-card shadow-md overflow-hidden">
            {filtered.map((o) => (
              <button key={o} onMouseDown={() => add(o)}
                className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-muted/60 transition-colors">
                {o.replace('-service', '')}
                <span className="ml-2 text-[10px] text-muted-foreground">{o}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ParamGrid({ params, defs, onChange }: { params: Record<string, string>; defs: ParamDef[]; onChange: (k: string, v: string) => void }) {
  if (!defs.length) return null;
  return (
    <div className="grid grid-cols-3 gap-4">
      {defs.map((p) => (
        <div key={p.key} className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">{p.label}</label>
          {p.type === 'select' ? (
            <select value={params[p.key]} onChange={(e) => onChange(p.key, e.target.value)}
              className="w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring">
              {(p.options ?? []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          ) : (
            <input type={p.type ?? 'text'} step={p.step} min={p.min} max={p.max}
              value={params[p.key]} onChange={(e) => onChange(p.key, e.target.value)}
              className="w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm font-mono text-foreground outline-none focus:ring-1 focus:ring-ring" />
          )}
        </div>
      ))}
    </div>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function ActionRow({ onInject, onDisarm, onCleanup, onStatus, loading }: { onInject: () => void; onDisarm: () => void; onCleanup?: () => void; onStatus: () => void; loading: boolean }) {
  return (
    <div className="flex gap-2 flex-wrap">
      <Button size="sm" variant="destructive" onClick={onInject} disabled={loading}>Inject</Button>
      <Button size="sm" variant="outline" onClick={onDisarm} disabled={loading}>Disarm</Button>
      {onCleanup && (
        <Button size="sm" variant="outline" className="border-warning/40 text-warning hover:bg-warning/10" onClick={onCleanup} disabled={loading}>Cleanup</Button>
      )}
      <Button size="sm" variant="ghost" className="ml-auto" onClick={onStatus} disabled={loading}>Status</Button>
    </div>
  );
}

function ResultOutput({ result }: { result: string | null }) {
  if (!result) return null;
  return (
    <pre className="text-xs text-muted-foreground bg-muted/40 rounded-md border border-border px-3 py-2.5 max-h-40 overflow-auto whitespace-pre-wrap font-mono">
      {result}
    </pre>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
      {children}
    </div>
  );
}

// ── API helper ────────────────────────────────────────────────────────────────

async function callApi(path: string, body?: unknown): Promise<string> {
  const isGet = path.includes('/status');
  const res   = await fetch(path, {
    method:  isGet ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    !isGet && body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  return JSON.stringify(json.data ?? json, null, 2);
}

// ── Panel implementations ─────────────────────────────────────────────────────

function SlowSqlPanel({ armed }: { armed?: boolean }) {
  const EXTRA: ParamDef[] = [
    { key: 'joinTable',   label: 'JOIN Table',   type: 'select', default: 'user_behavior_log', options: ['user_behavior_log','product_price_history'] },
    { key: 'limitRows',   label: 'LIMIT',        type: 'number', default: '1',      min: '1' },
    { key: 'offsetRows',  label: 'OFFSET',       type: 'number', default: '200000', min: '0' },
    { key: 'durationSec', label: 'Duration (s)', type: 'number', default: '300' },
  ];
  const [selected, setSelected] = useState(['inventory-service']);
  const [params, setParams]     = useState(Object.fromEntries(EXTRA.map((p) => [p.key, p.default])));
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState<string | null>(null);

  const call = async (path: string, body?: unknown) => { setLoading(true); try { setResult(await callApi(path, body)); } catch (e: unknown) { setResult(String(e)); } finally { setLoading(false); } };
  const body = () => ({ targets: selected, ...Object.fromEntries(EXTRA.map((p) => [p.key, p.type === 'number' ? parseFloat(params[p.key]) : params[p.key]])) });

  return (
    <div className="space-y-6">
      <PanelHeader title="Slow SQL" danger="high" armed={armed} />
      <Section label="Target services">
        <MultiSelectCombobox options={SLOW_SQL_TARGETS} selected={selected} onChange={setSelected} />
      </Section>
      <Section label="Parameters">
        <ParamGrid params={params} defs={EXTRA} onChange={(k, v) => setParams((p) => ({ ...p, [k]: v }))} />
      </Section>
      <ActionRow loading={loading}
        onInject={() => call('/internal/traffic/chaos/slow-sql/enable', body())}
        onDisarm={() => call('/internal/traffic/chaos/slow-sql/disable', { targets: selected })}
        onStatus={() => call('/internal/traffic/chaos/slow-sql/status')} />
      <ResultOutput result={result} />
    </div>
  );
}

function MemoryLeakPanel({ armed }: { armed?: boolean }) {
  const EXTRA: ParamDef[] = [
    { key: 'chunkSizeKb', label: 'Chunk (KB)',    type: 'number', default: '512' },
    { key: 'intervalMs',  label: 'Interval (ms)', type: 'number', default: '500' },
  ];
  const [selected, setSelected] = useState(['payment-service']);
  const [params, setParams]     = useState(Object.fromEntries(EXTRA.map((p) => [p.key, p.default])));
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState<string | null>(null);

  const call = async (path: string, body?: unknown) => { setLoading(true); try { setResult(await callApi(path, body)); } catch (e: unknown) { setResult(String(e)); } finally { setLoading(false); } };
  const body = () => ({ targets: selected, ...Object.fromEntries(EXTRA.map((p) => [p.key, parseFloat(params[p.key])])) });

  return (
    <div className="space-y-6">
      <PanelHeader title="Memory Leak" danger="high" armed={armed} />
      <Section label="Target services">
        <MultiSelectCombobox options={MEMORY_LEAK_TARGETS} selected={selected} onChange={setSelected} />
      </Section>
      <Section label="Parameters">
        <ParamGrid params={params} defs={EXTRA} onChange={(k, v) => setParams((p) => ({ ...p, [k]: v }))} />
      </Section>
      <ActionRow loading={loading}
        onInject={() => call('/internal/traffic/chaos/memory-leak/enable', body())}
        onDisarm={() => call('/internal/traffic/chaos/memory-leak/disable', { targets: selected })}
        onCleanup={() => call('/internal/traffic/chaos/memory-leak/cleanup', { targets: selected })}
        onStatus={() => call('/internal/traffic/chaos/memory-leak/status')} />
      <ResultOutput result={result} />
    </div>
  );
}

function DeadlockPanel({ armed }: { armed?: boolean }) {
  const EXTRA: ParamDef[] = [
    { key: 'injectRate',  label: 'Inject Rate', type: 'number', default: '0.5', step: '0.1', min: '0', max: '1' },
    { key: 'durationSec', label: 'Duration (s)',type: 'number', default: '300' },
  ];
  const [selected, setSelected] = useState(['payment-service']);
  const [params, setParams]     = useState(Object.fromEntries(EXTRA.map((p) => [p.key, p.default])));
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState<string | null>(null);

  const call = async (path: string, body?: unknown) => { setLoading(true); try { setResult(await callApi(path, body)); } catch (e: unknown) { setResult(String(e)); } finally { setLoading(false); } };
  const body = () => ({ targets: selected, scope: 'ALL', ...Object.fromEntries(EXTRA.map((p) => [p.key, parseFloat(params[p.key])])) });

  return (
    <div className="space-y-6">
      <PanelHeader title="Deadlock Injection" danger="critical" armed={armed} />
      <Section label="Target services">
        <MultiSelectCombobox options={DEADLOCK_TARGETS} selected={selected} onChange={setSelected} />
      </Section>
      <Section label="Parameters">
        <ParamGrid params={params} defs={EXTRA} onChange={(k, v) => setParams((p) => ({ ...p, [k]: v }))} />
      </Section>
      <ActionRow loading={loading}
        onInject={() => call('/internal/traffic/chaos/deadlock/enable', body())}
        onDisarm={() => call('/internal/traffic/chaos/deadlock/disable', { targets: selected })}
        onCleanup={() => call('/internal/traffic/chaos/deadlock/cleanup', { targets: selected })}
        onStatus={() => call('/internal/traffic/chaos/deadlock/status')} />
      <ResultOutput result={result} />
    </div>
  );
}

function TableLockPanel({ armed }: { armed?: boolean }) {
  const [service, setService]   = useState(TABLE_LOCK_SERVICES[0]);
  const [table, setTable]       = useState(TABLES_PER_SERVICE[TABLE_LOCK_SERVICES[0]]?.[0] ?? '');
  const [duration, setDuration] = useState('300');
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState<string | null>(null);

  const handleSvc = (s: string) => { setService(s); setTable(TABLES_PER_SERVICE[s]?.[0] ?? ''); };
  const call = async (path: string, body?: unknown) => {
    setLoading(true);
    try {
      const isGet = path.includes('/status');
      const url   = isGet ? `${path}?targetService=${service}&targetTable=${table}` : path;
      setResult(await callApi(isGet ? url : path, !isGet ? body : undefined));
    } catch (e: unknown) { setResult(String(e)); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-6">
      <PanelHeader title="Table Lock" danger="high" armed={armed} />
      <Section label="Target">
        <div className="grid grid-cols-3 gap-4">
          <SelectField label="Service" value={service} onChange={handleSvc}
            options={TABLE_LOCK_SERVICES.map((s) => ({ value: s, label: s.replace('-service','') }))} />
          <SelectField label="Table" value={table} onChange={setTable}
            options={(TABLES_PER_SERVICE[service] ?? []).map((t) => ({ value: t, label: t }))} />
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Duration (s)</label>
            <input type="number" min="10" value={duration} onChange={(e) => setDuration(e.target.value)}
              className="w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm font-mono text-foreground outline-none focus:ring-1 focus:ring-ring" />
          </div>
        </div>
      </Section>
      <ActionRow loading={loading}
        onInject={() => call('/internal/traffic/chaos/table-lock/enable', { targetService: service, targetTable: table, durationSec: parseInt(duration, 10) })}
        onDisarm={() => call('/internal/traffic/chaos/table-lock/disable', { targetService: service, targetTable: table })}
        onStatus={() => call('/internal/traffic/chaos/table-lock/status')} />
      <ResultOutput result={result} />
    </div>
  );
}

function NetworkDelayPanel({ armed }: { armed?: boolean }) {
  const EXTRA = [
    { key: 'latencyMs', label: 'Latency (ms)', default: '5000' },
    { key: 'jitter',    label: 'Jitter (ms)',  default: '2000' },
  ];
  const [proxy, setProxy]     = useState(PROXY_NAMES[0]);
  const [params, setParams]   = useState(Object.fromEntries(EXTRA.map((p) => [p.key, p.default])));
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState<string | null>(null);

  const call = async (path: string, body?: unknown) => {
    setLoading(true);
    try {
      const isGet = path.includes('/status');
      const url   = isGet ? `${path}?proxyName=${proxy}` : path;
      setResult(await callApi(isGet ? url : path, !isGet ? body : undefined));
    } catch (e: unknown) { setResult(String(e)); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-6">
      <PanelHeader title="Network Delay" danger="medium" armed={armed} />
      <Section label="Target">
        <div className="grid grid-cols-3 gap-4">
          <SelectField label="Proxy" value={proxy} onChange={setProxy}
            options={PROXY_NAMES.map((p) => ({ value: p, label: p }))} />
          {EXTRA.map((p) => (
            <div key={p.key} className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{p.label}</label>
              <input type="number" value={params[p.key]} onChange={(e) => setParams((prev) => ({ ...prev, [p.key]: e.target.value }))}
                className="w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm font-mono text-foreground outline-none focus:ring-1 focus:ring-ring" />
            </div>
          ))}
        </div>
      </Section>
      <ActionRow loading={loading}
        onInject={() => call('/internal/traffic/chaos/network-delay/enable', { proxyName: proxy, ...Object.fromEntries(EXTRA.map((p) => [p.key, parseInt(params[p.key], 10)])) })}
        onDisarm={() => call('/internal/traffic/chaos/network-delay/disable', { proxyName: proxy })}
        onStatus={() => call('/internal/traffic/chaos/network-delay/status')} />
      <ResultOutput result={result} />
    </div>
  );
}

function NetworkResetPanel({ armed }: { armed?: boolean }) {
  const [proxy, setProxy]     = useState(PROXY_NAMES[0]);
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState<string | null>(null);

  const call = async (path: string, body?: unknown) => {
    setLoading(true);
    try {
      const isGet = path.includes('/status');
      const url   = isGet ? `${path}?proxyName=${proxy}` : path;
      setResult(await callApi(isGet ? url : path, !isGet ? body : undefined));
    } catch (e: unknown) { setResult(String(e)); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-6">
      <PanelHeader title="Network Reset" danger="high" armed={armed} />
      <Section label="Target">
        <div className="grid grid-cols-3 gap-4">
          <SelectField label="Proxy" value={proxy} onChange={setProxy}
            options={PROXY_NAMES.map((p) => ({ value: p, label: p }))} />
        </div>
      </Section>
      <ActionRow loading={loading}
        onInject={() => call('/internal/traffic/chaos/network-reset/enable', { proxyName: proxy, latencyMs: 0, jitter: 0 })}
        onDisarm={() => call('/internal/traffic/chaos/network-reset/disable', { proxyName: proxy })}
        onStatus={() => call('/internal/traffic/chaos/network-reset/status')} />
      <ResultOutput result={result} />
    </div>
  );
}
