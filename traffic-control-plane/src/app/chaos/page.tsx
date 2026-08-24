'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Zap, ShieldOff, Trash2, Activity, AlertCircle } from 'lucide-react';
import { fetchWithAuth } from '@/lib/auth-fetch';

// ── Constants ────────────────────────────────────────────────────────────────

const SLOW_SQL_TARGETS    = ['catalog-service','inventory-service','order-service','payment-service','promotion-service','risk-service','fulfillment-service','notification-service'];
const MEMORY_LEAK_TARGETS = ['order-service','payment-service'];
const DEADLOCK_TARGETS    = ['order-service','payment-service'];
const STORAGE_GROWTH_TARGETS = ['catalog-service','risk-service','notification-service'];
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

type ChaosId = 'slow-sql' | 'memory-leak' | 'deadlock' | 'table-lock' | 'storage-growth' | 'network-delay' | 'network-reset';

const CHAOS_LIST: { id: ChaosId; label: string; danger: DangerLevel; statusPath: string }[] = [
  { id: 'slow-sql',      label: 'Slow SQL',       danger: 'high',     statusPath: '/internal/traffic/chaos/slow-sql/status' },
  { id: 'memory-leak',   label: 'Memory Leak',    danger: 'high',     statusPath: '/internal/traffic/chaos/memory-leak/status' },
  { id: 'deadlock',      label: 'Deadlock',       danger: 'critical', statusPath: '/internal/traffic/chaos/deadlock/status' },
  { id: 'table-lock',    label: 'Table Lock',     danger: 'high',     statusPath: '/internal/traffic/chaos/table-lock/status' },
  { id: 'storage-growth',label: 'Storage Growth', danger: 'critical', statusPath: '/internal/traffic/chaos/storage-growth/status' },
  { id: 'network-delay', label: 'Network Delay',  danger: 'medium',   statusPath: '/internal/traffic/chaos/network-delay/status' },
  { id: 'network-reset', label: 'Network Reset',  danger: 'high',     statusPath: '/internal/traffic/chaos/network-reset/status' },
];

// ── Hooks ────────────────────────────────────────────────────────────────────

function isActive(d: unknown): boolean {
  if (typeof d !== 'object' || d === null) return false;
  const o = d as Record<string, unknown>;
  if (o.active === true || o.enabled === true) return true;
  return Object.values(o).some((v) => isActive(v));
}

function activeServices(d: unknown): string[] {
  if (typeof d !== 'object' || d === null) return [];
  const o = d as Record<string, unknown>;
  if ('active' in o || 'enabled' in o) return [];
  return Object.entries(o)
    .filter(([, child]) => isActive(child))
    .map(([svc]) => svc.replace('-service', ''));
}

function useArmedStatus() {
  const [armed, setArmed]       = useState<Record<string, boolean>>({});
  const [armedSvcs, setArmedSvcs] = useState<Record<string, string[]>>({});

  useEffect(() => {
    const poll = async () => {
      const results = await Promise.allSettled(
        CHAOS_LIST.map(async (c) => {
          const res  = await fetchWithAuth(c.statusPath);
          const json = await res.json();
          return { id: c.id, active: isActive(json.data), svcs: activeServices(json.data) };
        })
      );
      const nextArmed: Record<string, boolean>   = {};
      const nextSvcs:  Record<string, string[]>  = {};
      results.forEach((r) => {
        if (r.status === 'fulfilled') {
          nextArmed[r.value.id] = r.value.active;
          nextSvcs[r.value.id]  = r.value.svcs;
        }
      });
      setArmed(nextArmed);
      setArmedSvcs(nextSvcs);
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, []);

  return { armed, armedSvcs };
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ChaosControlPage() {
  const [selected, setSelected] = useState<ChaosId>('slow-sql');
  const { armed, armedSvcs } = useArmedStatus();

  const armedCount = Object.values(armed).filter(Boolean).length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Chaos Control</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Fault injection — armed and ready</p>
      </div>

      {/* Active chaos banner — always visible */}
      {armedCount > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
          <span className="text-[11px] font-medium text-destructive/70 shrink-0">Active:</span>
          {CHAOS_LIST.filter((c) => armed[c.id]).map((c) => {
            const svcs = armedSvcs[c.id] ?? [];
            return (
              <button
                key={c.id}
                onClick={() => setSelected(c.id)}
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-destructive/10 border border-destructive/30 text-destructive hover:bg-destructive/20 transition-colors"
              >
                <span className="status-dot status-dot-red" style={{ width: 6, height: 6 }} />
                {c.label}{svcs.length > 0 ? ` · ${svcs.join(', ')}` : ''}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2">
          <span className="status-dot status-dot-green" style={{ width: 6, height: 6 }} />
          <span className="text-xs text-muted-foreground">No active fault injections</span>
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
          {selected === 'storage-growth' && <StorageGrowthPanel armed={armed['storage-growth']} />}
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
      <Button size="sm" variant="destructive" onClick={onInject} disabled={loading}>
        <Zap />Inject
      </Button>
      <Button size="sm" variant="outline" onClick={onDisarm} disabled={loading}>
        <ShieldOff />Disarm
      </Button>
      {onCleanup && (
        <Button size="sm" variant="outline" className="border-warning/40 text-warning hover:bg-warning/10" onClick={onCleanup} disabled={loading}>
          <Trash2 />Cleanup
        </Button>
      )}
      <Button size="sm" variant="ghost" className="ml-auto" onClick={onStatus} disabled={loading}>
        <Activity />Status
      </Button>
    </div>
  );
}

function ResultOutput({ result }: { result: ApiResult | null }) {
  if (!result) return null;

  if (!result.ok) {
    return (
      <div className="flex items-start gap-2.5 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5">
        <AlertCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-xs font-medium text-destructive capitalize">{result.action} failed</p>
          <p className="text-xs text-destructive/80 mt-0.5 break-words">{result.message}</p>
        </div>
      </div>
    );
  }

  if (result.action === 'status') {
    return <StatusResult data={result.data} />;
  }

  // inject / disarm / cleanup success
  const icons: Record<ApiAction, React.ReactNode> = {
    inject:  <Zap className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />,
    disarm:  <ShieldOff className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 shrink-0" />,
    cleanup: <Trash2 className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />,
    status:  <Activity className="h-3.5 w-3.5 shrink-0" />,
  };
  const colors: Record<ApiAction, string> = {
    inject:  'border-emerald-500/30 bg-emerald-500/5',
    disarm:  'border-blue-500/30 bg-blue-500/5',
    cleanup: 'border-amber-500/30 bg-amber-500/5',
    status:  'border-border bg-muted/30',
  };

  return (
    <div className={`flex items-start gap-2.5 rounded-md border px-3 py-2.5 ${colors[result.action]}`}>
      {icons[result.action]}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium capitalize text-foreground">{result.action} succeeded</p>
        {result.data !== null && result.data !== undefined && (
          <ActionSummary action={result.action} data={result.data} />
        )}
      </div>
    </div>
  );
}

function ActionSummary({ action, data }: { action: ApiAction; data: unknown }) {
  if (typeof data !== 'object' || data === null) {
    return <p className="text-xs text-muted-foreground mt-0.5">{String(data)}</p>;
  }
  const d = data as Record<string, unknown>;

  // Per-service result map: { "payment-service": { code, message, ... }, ... }
  const isPerService = Object.keys(d).length > 0 &&
    Object.keys(d).every((k) => k.includes('-service') || k.includes('-'));

  if (isPerService && (action === 'inject' || action === 'disarm' || action === 'cleanup')) {
    return (
      <div className="mt-1.5 space-y-0.5">
        {Object.entries(d).map(([svc, v]) => {
          const name    = svc.replace('-service', '');
          const ok      = typeof v === 'object' && v !== null ? (v as Record<string, unknown>).code === 0 || (v as Record<string, unknown>).success === true : true;
          const msg     = typeof v === 'object' && v !== null ? String((v as Record<string, unknown>).message ?? '') : '';
          return (
            <div key={svc} className="flex items-center gap-1.5 text-xs">
              <span className="font-mono text-muted-foreground w-24 truncate">{name}</span>
              <span className={ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}>
                {ok ? `${action} ok` : (msg || `${action} failed`)}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  if (action === 'inject') {
    const targets = Array.isArray(d.targets) ? (d.targets as string[]).map((s) => s.replace('-service', '')).join(', ') : null;
    const dur     = d.durationSec != null ? `${d.durationSec}s` : null;
    const kvs     = [targets && `targets: ${targets}`, dur && `duration: ${dur}`].filter(Boolean);
    if (kvs.length === 0) return null;
    return <p className="text-xs text-muted-foreground mt-0.5">{kvs.join(' · ')}</p>;
  }

  if (action === 'disarm' || action === 'cleanup') {
    const keys = Object.keys(d);
    if (keys.length === 0) return null;
    return <p className="text-xs text-muted-foreground mt-0.5">{keys.length} service{keys.length !== 1 ? 's' : ''} updated</p>;
  }

  return null;
}

function StatusResult({ data }: { data: unknown }) {
  const isObj = typeof data === 'object' && data !== null;

  if (!isObj) {
    return (
      <pre className="text-xs text-muted-foreground bg-muted/40 rounded-md border border-border px-3 py-2.5 max-h-40 overflow-auto whitespace-pre-wrap font-mono">
        {JSON.stringify(data, null, 2)}
      </pre>
    );
  }

  const entries = Object.entries(data as Record<string, unknown>);

  // Unwrap per-service ApiResponse envelope: { code, message, data: { active, ... } }
  const unwrap = (v: unknown): Record<string, unknown> => {
    if (typeof v !== 'object' || v === null) return {};
    const obj = v as Record<string, unknown>;
    if ('code' in obj && 'data' in obj && typeof obj.data === 'object' && obj.data !== null) {
      return obj.data as Record<string, unknown>;
    }
    return obj;
  };

  const hasPerService = entries.length > 0 && entries.every(([k]) => k.includes('-') || k.includes('service'));
  const unwrappedEntries = entries.map(([k, v]) => [k, unwrap(v)] as [string, Record<string, unknown>]);
  const hasStorageGrowthStatus = unwrappedEntries.some(([, v]) =>
    'writtenBytes' in v || 'targetBytes' in v || 'writtenRows' in v,
  );

  if (hasStorageGrowthStatus) {
    return <StorageGrowthStatusResult entries={unwrappedEntries} />;
  }

  const hasActive = unwrappedEntries.some(([, v]) => 'active' in v || 'enabled' in v);

  if (hasActive || hasPerService) {
    // Per-service status map
    return (
      <div className="space-y-1.5">
        {unwrappedEntries.map(([svc, v]) => {
          const active = v?.active === true || v?.enabled === true;
          return (
            <div key={svc} className="flex items-center justify-between gap-3 rounded border border-border/60 bg-muted/20 px-2.5 py-1.5">
              <span className="text-xs font-mono text-muted-foreground">{svc.replace('-service', '')}</span>
              <div className="flex items-center gap-2">
                {v?.durationSec != null && (
                  <span className="text-[10px] text-muted-foreground/70">{String(v.durationSec)}s</span>
                )}
                <Badge variant={active ? 'destructive' : 'secondary'} className="text-[10px] py-0 px-1.5 gap-1">
                  {active && <span className="status-dot status-dot-red" style={{ width: 5, height: 5 }} />}
                  {active ? 'active' : 'idle'}
                </Badge>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Flat status object (e.g. network, table-lock)
  const active = (data as Record<string, unknown>).active === true || (data as Record<string, unknown>).enabled === true;
  const rest   = Object.entries(data as Record<string, unknown>).filter(([k]) => k !== 'active' && k !== 'enabled');
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Badge variant={active ? 'destructive' : 'secondary'} className="text-[10px] py-0 px-1.5 gap-1">
          {active && <span className="status-dot status-dot-red" style={{ width: 5, height: 5 }} />}
          {active ? 'active' : 'idle'}
        </Badge>
      </div>
      {rest.length > 0 && (
        <pre className="text-xs text-muted-foreground bg-muted/40 rounded-md border border-border px-3 py-2 max-h-32 overflow-auto whitespace-pre-wrap font-mono">
          {JSON.stringify(Object.fromEntries(rest), null, 2)}
        </pre>
      )}
    </div>
  );
}

function StorageGrowthStatusResult({ entries }: { entries: [string, Record<string, unknown>][] }) {
  const formatBytes = (value: unknown) => {
    const bytes = Number(value);
    if (!Number.isFinite(bytes)) return '-';
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
  };

  const formatTime = (value: unknown) => {
    if (!value) return '-';
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  };

  return (
    <div className="space-y-2">
      {entries.map(([svc, status]) => {
        const state = String(status.status ?? 'UNKNOWN');
        const writtenBytes = Number(status.writtenBytes ?? 0);
        const targetBytes = Number(status.targetBytes ?? 0);
        const progress = targetBytes > 0 ? Math.min(100, (writtenBytes / targetBytes) * 100) : 0;
        const isRunning = state === 'RUNNING';
        const isError = state === 'ERROR';
        const variant = isRunning || isError ? 'destructive' : 'secondary';

        return (
          <div key={svc} className="rounded border border-border/60 bg-muted/20 px-2.5 py-2.5 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-mono text-muted-foreground">{svc.replace('-service', '')}</span>
              <Badge variant={variant} className="text-[10px] py-0 px-1.5 gap-1">
                {isRunning && <span className="status-dot status-dot-red" style={{ width: 5, height: 5 }} />}
                {state}
              </Badge>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-border/70">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-muted-foreground sm:grid-cols-4">
              <span>Written <strong className="font-mono text-foreground">{formatBytes(writtenBytes)}</strong></span>
              <span>Target <strong className="font-mono text-foreground">{formatBytes(targetBytes)}</strong></span>
              <span>Progress <strong className="font-mono text-foreground">{progress.toFixed(1)}%</strong></span>
              <span>Rows <strong className="font-mono text-foreground">{String(status.writtenRows ?? 0)}</strong></span>
              <span>Rate <strong className="font-mono text-foreground">{formatBytes(status.rateBytesPerSec)}/s</strong></span>
              <span>Type <strong className="font-mono text-foreground">{String(status.target ?? status.storageType ?? '-')}</strong></span>
              <span>Run <strong className="font-mono text-foreground">{String(status.runId ?? '-')}</strong></span>
              <span>Stop <strong className="font-mono text-foreground">{String(status.stopReason || '-')}</strong></span>
            </div>
            <div className="text-[10px] text-muted-foreground/70">
              Started {formatTime(status.startedAt)} · Stopped {formatTime(status.stoppedAt)}
            </div>
          </div>
        );
      })}
    </div>
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

type ApiAction = 'inject' | 'disarm' | 'cleanup' | 'status';

interface ApiResult {
  ok: boolean;
  action: ApiAction;
  data: unknown;
  message?: string;
}

async function callApi(action: ApiAction, path: string, body?: unknown): Promise<ApiResult> {
  const isGet = path.includes('/status');
  try {
    const res  = await fetchWithAuth(path, {
      method:  isGet ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    !isGet && body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    if (!res.ok || (json.code !== undefined && json.code !== 0)) {
      return { ok: false, action, data: json.data ?? null, message: json.message ?? `HTTP ${res.status}` };
    }
    return { ok: true, action, data: json.data ?? json };
  } catch (e: unknown) {
    return { ok: false, action, data: null, message: String(e) };
  }
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
  const [result, setResult]     = useState<ApiResult | null>(null);

  const call = async (action: ApiAction, path: string, body?: unknown) => { setLoading(true); setResult(await callApi(action, path, body)); setLoading(false); };
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
        onInject={() => call('inject', '/internal/traffic/chaos/slow-sql/enable', body())}
        onDisarm={() => call('disarm', '/internal/traffic/chaos/slow-sql/disable', { targets: selected })}
        onStatus={() => call('status', '/internal/traffic/chaos/slow-sql/status')} />
      <ResultOutput result={result} />
    </div>
  );
}

function MemoryLeakPanel({ armed }: { armed?: boolean }) {
  const EXTRA: ParamDef[] = [
    { key: 'chunkSizeKb', label: 'Chunk (KB)',    type: 'number', default: '512' },
    { key: 'intervalMs',  label: 'Interval (ms)', type: 'number', default: '500' },
    { key: 'durationSec', label: 'Duration (s)',  type: 'number', default: '300' },
  ];
  const [selected, setSelected] = useState(['payment-service']);
  const [params, setParams]     = useState(Object.fromEntries(EXTRA.map((p) => [p.key, p.default])));
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState<ApiResult | null>(null);

  const call = async (action: ApiAction, path: string, body?: unknown) => { setLoading(true); setResult(await callApi(action, path, body)); setLoading(false); };
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
        onInject={() => call('inject', '/internal/traffic/chaos/memory-leak/enable', body())}
        onDisarm={() => call('disarm', '/internal/traffic/chaos/memory-leak/disable', { targets: selected })}
        onCleanup={() => call('cleanup', '/internal/traffic/chaos/memory-leak/cleanup', { targets: selected })}
        onStatus={() => call('status', '/internal/traffic/chaos/memory-leak/status')} />
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
  const [result, setResult]     = useState<ApiResult | null>(null);

  const call = async (action: ApiAction, path: string, body?: unknown) => { setLoading(true); setResult(await callApi(action, path, body)); setLoading(false); };
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
        onInject={() => call('inject', '/internal/traffic/chaos/deadlock/enable', body())}
        onDisarm={() => call('disarm', '/internal/traffic/chaos/deadlock/disable', { targets: selected })}
        onCleanup={() => call('cleanup', '/internal/traffic/chaos/deadlock/cleanup', { targets: selected })}
        onStatus={() => call('status', '/internal/traffic/chaos/deadlock/status')} />
      <ResultOutput result={result} />
    </div>
  );
}

function TableLockPanel({ armed }: { armed?: boolean }) {
  const [service, setService]   = useState(TABLE_LOCK_SERVICES[0]);
  const [table, setTable]       = useState(TABLES_PER_SERVICE[TABLE_LOCK_SERVICES[0]]?.[0] ?? '');
  const [duration, setDuration] = useState('300');
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState<ApiResult | null>(null);

  const handleSvc = (s: string) => { setService(s); setTable(TABLES_PER_SERVICE[s]?.[0] ?? ''); };
  const call = async (action: ApiAction, path: string, body?: unknown) => {
    setLoading(true);
    const isGet = path.includes('/status');
    const url   = isGet ? `${path}?targetService=${service}&targetTable=${table}` : path;
    setResult(await callApi(action, isGet ? url : path, !isGet ? body : undefined));
    setLoading(false);
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
        onInject={() => call('inject', '/internal/traffic/chaos/table-lock/enable', { targetService: service, targetTable: table, durationSec: parseInt(duration, 10) })}
        onDisarm={() => call('disarm', '/internal/traffic/chaos/table-lock/disable', { targetService: service, targetTable: table })}
        onStatus={() => call('status', '/internal/traffic/chaos/table-lock/status')} />
      <ResultOutput result={result} />
    </div>
  );
}

function StorageGrowthPanel({ armed }: { armed?: boolean }) {
  const [service, setService] = useState(STORAGE_GROWTH_TARGETS[0]);
  const [storageType, setStorageType] = useState('mysql');
  const [runId, setRunId] = useState('storage-demo-001');
  const [targetMb, setTargetMb] = useState('3072');
  const [rateMb, setRateMb] = useState('10');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);

  const targetBytes = Number(targetMb) * 1024 * 1024;
  const rateBytesPerSec = Number(rateMb) * 1024 * 1024;
  const duration = targetBytes > 0 && rateBytesPerSec > 0
    ? Math.ceil(targetBytes / rateBytesPerSec)
    : 0;

  const call = async (action: ApiAction, path: string, body?: unknown) => {
    setLoading(true);
    const isGet = path.includes('/status');
    const url = isGet ? `${path}?targetService=${service}` : path;
    setResult(await callApi(action, isGet ? url : path, !isGet ? body : undefined));
    setLoading(false);
  };

  const body = () => ({
    targetService: service,
    storageType,
    runId,
    targetBytes,
    rateBytesPerSec,
    durationSec: duration,
    minFreeBytes: 1024 * 1024 * 1024,
    minFreePercent: 10,
  });

  return (
    <div className="space-y-6">
      <PanelHeader title="Storage Growth" danger="critical" armed={armed} />
      <Section label="Target service">
        <SelectField label="Service" value={service} onChange={setService}
          options={STORAGE_GROWTH_TARGETS.map((s) => ({ value: s, label: s.replace('-service', '') }))} />
      </Section>
      <Section label="Storage target">
        <SelectField label="Type" value={storageType} onChange={setStorageType}
          options={[{ value: 'mysql', label: 'MySQL data volume' }, { value: 'filesystem', label: 'Service filesystem' }]} />
        <div className="mt-4 space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Run ID</label>
          <input value={runId} onChange={(e) => setRunId(e.target.value)}
            className="w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm font-mono text-foreground outline-none focus:ring-1 focus:ring-ring" />
        </div>
      </Section>
      <Section label="Write parameters">
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Target (MB)</label>
            <input type="number" min="1" max="10240" value={targetMb} onChange={(e) => setTargetMb(e.target.value)}
              className="w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm font-mono text-foreground outline-none focus:ring-1 focus:ring-ring" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Rate (MB/s)</label>
            <input type="number" min="1" max="100" value={rateMb} onChange={(e) => setRateMb(e.target.value)}
              className="w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm font-mono text-foreground outline-none focus:ring-1 focus:ring-ring" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Duration (s, calculated)</label>
            <input type="number" value={duration} readOnly
              className="w-full rounded-md border border-border bg-muted px-2.5 py-1.5 text-sm font-mono text-muted-foreground outline-none" />
          </div>
        </div>
      </Section>
      <ActionRow loading={loading}
        onInject={() => call('inject', '/internal/traffic/chaos/storage-growth/enable', body())}
        onDisarm={() => call('disarm', '/internal/traffic/chaos/storage-growth/disable', { targetService: service })}
        onCleanup={() => call('cleanup', '/internal/traffic/chaos/storage-growth/cleanup', { targetService: service, storageType, runId })}
        onStatus={() => call('status', '/internal/traffic/chaos/storage-growth/status')} />
      <ResultOutput result={result} />
    </div>
  );
}

function NetworkDelayPanel({ armed }: { armed?: boolean }) {
  const EXTRA = [
    { key: 'latencyMs', label: 'Latency (ms)', default: '5000' },
    { key: 'jitter',    label: 'Jitter (ms)',  default: '2000' },
    { key: 'durationSec', label: 'Duration (s)', default: '300' },
  ];
  const [proxy, setProxy]     = useState(PROXY_NAMES[0]);
  const [params, setParams]   = useState(Object.fromEntries(EXTRA.map((p) => [p.key, p.default])));
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState<ApiResult | null>(null);

  const call = async (action: ApiAction, path: string, body?: unknown) => {
    setLoading(true);
    const isGet = path.includes('/status');
    const url   = isGet ? `${path}?proxyName=${proxy}` : path;
    setResult(await callApi(action, isGet ? url : path, !isGet ? body : undefined));
    setLoading(false);
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
        onInject={() => call('inject', '/internal/traffic/chaos/network-delay/enable', { proxyName: proxy, ...Object.fromEntries(EXTRA.map((p) => [p.key, parseInt(params[p.key], 10)])) })}
        onDisarm={() => call('disarm', '/internal/traffic/chaos/network-delay/disable', { proxyName: proxy })}
        onStatus={() => call('status', '/internal/traffic/chaos/network-delay/status')} />
      <ResultOutput result={result} />
    </div>
  );
}

function NetworkResetPanel({ armed }: { armed?: boolean }) {
  const [proxy, setProxy]     = useState(PROXY_NAMES[0]);
  const [duration, setDuration] = useState('300');
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState<ApiResult | null>(null);

  const call = async (action: ApiAction, path: string, body?: unknown) => {
    setLoading(true);
    const isGet = path.includes('/status');
    const url   = isGet ? `${path}?proxyName=${proxy}` : path;
    setResult(await callApi(action, isGet ? url : path, !isGet ? body : undefined));
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      <PanelHeader title="Network Reset" danger="high" armed={armed} />
      <Section label="Target">
        <div className="grid grid-cols-3 gap-4">
          <SelectField label="Proxy" value={proxy} onChange={setProxy}
            options={PROXY_NAMES.map((p) => ({ value: p, label: p }))} />
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Duration (s)</label>
            <input type="number" min="1" value={duration} onChange={(e) => setDuration(e.target.value)}
              className="w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm font-mono text-foreground outline-none focus:ring-1 focus:ring-ring" />
          </div>
        </div>
      </Section>
      <ActionRow loading={loading}
        onInject={() => call('inject', '/internal/traffic/chaos/network-reset/enable', { proxyName: proxy, latencyMs: 0, jitter: 0, durationSec: parseInt(duration, 10) })}
        onDisarm={() => call('disarm', '/internal/traffic/chaos/network-reset/disable', { proxyName: proxy })}
        onStatus={() => call('status', '/internal/traffic/chaos/network-reset/status')} />
      <ResultOutput result={result} />
    </div>
  );
}
