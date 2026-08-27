'use client';

import { useEffect, useState } from 'react';
import {
  Activity, AlertTriangle, CheckCircle2, ChevronDown, Clock3, DatabaseZap, Flame,
  LockKeyhole, RefreshCw, ServerCog, ShieldCheck, Square, WalletCards,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchWithAuth } from '@/lib/auth-fetch';
import ScenarioCardWithActions from '@/components/ScenarioCardWithActions';

type Parameter = { name: string; kind: 'integer' | 'number' | 'string'; required?: boolean; default?: number | string; min?: number; max?: number; maxLength?: number };
type Scenario = { scenario: string; targetService: string; targetOperation: string; maxDurationSec: number; recoveryStrategy: string; allowManualCleanup: boolean; parameters: Parameter[] };
type FaultRun = { faultRunId: string; scenario: string; targetService: string; targetOperation: string; state: string; expiresAt: string; createdAt: string; operatorAuditId?: number | null };
type Event = { id: number; eventType: string; payload?: unknown; createdAt: string };
type ConsoleData = { scenarios: Scenario[]; runs: FaultRun[] };
type FaultRunDetails = { run: FaultRun; events: Event[] };

const ACTIVE_STATES = ['CREATING', 'ACTIVE', 'RECOVERING'];
const SCENARIO_META: Record<string, { label: string; description: string; icon: typeof Activity; tone: string }> = {
  BROWSE_REPORT_SQL: { label: 'Browse report SQL', description: 'Exercise historical scans and query-plan differences on the product report path.', icon: DatabaseZap, tone: 'text-amber-700 dark:text-amber-300' },
  ORDER_REPORT_SQL: { label: 'Order report SQL', description: 'Exercise the customer order report range and detail aggregation path.', icon: DatabaseZap, tone: 'text-amber-700 dark:text-amber-300' },
  BROWSE_SURGE: { label: 'Browse traffic surge', description: 'Sustain controlled concurrency against the real product API through Gateway.', icon: Flame, tone: 'text-orange-700 dark:text-orange-300' },
  ORDER_QUERY_SURGE: { label: 'Order query surge', description: 'Sustain compliant demo-customer traffic against the order query path.', icon: Flame, tone: 'text-orange-700 dark:text-orange-300' },
  CART_REDIS_LARGE_VALUE: { label: 'Cart large Redis value', description: 'Create and read a large run-scoped Redis value through the fixed Sam cart.', icon: WalletCards, tone: 'text-emerald-700 dark:text-emerald-300' },
  CART_CATALOG_DEPENDENCY: { label: 'Cart dependency failure', description: 'Fail the real Cart-to-Catalog dependency before a cart write.', icon: ServerCog, tone: 'text-rose-700 dark:text-rose-300' },
  NOTIFICATION_HEAP_PRESSURE: { label: 'JVM memory leak', description: 'Retain high-cardinality objects until the notification JVM runs out of heap.', icon: AlertTriangle, tone: 'text-red-700 dark:text-red-300' },
  NOTIFICATION_STORAGE_APPEND: { label: 'Notification storage growth', description: 'Grow persistent storage with run-scoped notification transaction data.', icon: DatabaseZap, tone: 'text-violet-700 dark:text-violet-300' },
  PROMOTION_LOCK_CONTENTION: { label: 'Promotion deadlock', description: 'Trigger a real database deadlock through competing promotion reservations.', icon: LockKeyhole, tone: 'text-cyan-700 dark:text-cyan-300' },
  INVENTORY_TABLE_EXCLUSIVE: { label: 'Inventory table lock', description: 'Hold an exclusive database table lock that blocks inventory reads.', icon: LockKeyhole, tone: 'text-cyan-700 dark:text-cyan-300' },
  PSP_PROVIDER_OUTCOME: { label: 'PSP external dependency', description: 'Inject an external PSP dependency outcome into the payment path.', icon: ShieldCheck, tone: 'text-blue-700 dark:text-blue-300' },
};
const SCENARIO_GROUPS = [
  { label: 'Slow SQL', scenarios: ['BROWSE_REPORT_SQL', 'ORDER_REPORT_SQL'] },
  { label: 'Traffic surge', scenarios: ['BROWSE_SURGE', 'ORDER_QUERY_SURGE'] },
  { label: 'Large value', scenarios: ['CART_REDIS_LARGE_VALUE'] },
  { label: 'Dependency failure', scenarios: ['CART_CATALOG_DEPENDENCY'] },
  { label: 'Memory leak', scenarios: ['NOTIFICATION_HEAP_PRESSURE'] },
  { label: 'Storage growth', scenarios: ['NOTIFICATION_STORAGE_APPEND'] },
  { label: 'Deadlock', scenarios: ['PROMOTION_LOCK_CONTENTION'] },
  { label: 'Table lock', scenarios: ['INVENTORY_TABLE_EXCLUSIVE'] },
  { label: 'External dependency', scenarios: ['PSP_PROVIDER_OUTCOME'] },
];

export default function ScenarioControlPage() {
  const [data, setData] = useState<ConsoleData | null>(null);
  const [selectedRun, setSelectedRun] = useState<FaultRunDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filterState, setFilterState] = useState('ALL');
  const [filterScenario, setFilterScenario] = useState('ALL');
  const [selectedScenario, setSelectedScenario] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const load = async () => {
    try {
      const response = await fetchWithAuth('/internal/fault-runs');
      const result = await response.json() as { code: number; message: string; data: ConsoleData };
      if (!response.ok || result.code !== 0) throw new Error(result.message);
      setData(result.data);
      setSelectedScenario((current) => current || result.data.scenarios[0]?.scenario || '');
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load Fault Runs');
    }
  };

  useEffect(() => {
    const initialLoad = setTimeout(() => { void load(); }, 0);
    const timer = setInterval(() => { void load(); }, 5000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearTimeout(initialLoad);
      clearInterval(timer);
      clearInterval(clock);
    };
  }, []);

  const activeRun = data?.runs.find((run) => ACTIVE_STATES.includes(run.state));
  const unavailableHeapRun = data?.runs.find((run) => run.scenario === 'NOTIFICATION_HEAP_PRESSURE' && run.state === 'SERVICE_UNAVAILABLE');
  const visibleRuns = data?.runs.filter((run) => (filterState === 'ALL' || run.state === filterState) && (filterScenario === 'ALL' || run.scenario === filterScenario)) || [];

  const openDetails = async (run: FaultRun) => {
    try {
      const response = await fetchWithAuth(`/internal/fault-runs/${run.faultRunId}`);
      const result = await response.json() as { code: number; message: string; data: FaultRunDetails };
      if (!response.ok || result.code !== 0) throw new Error(result.message);
      setSelectedRun(result.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to load run details');
    }
  };

  const createRun = async (scenario: Scenario, parameters: Record<string, number | string>) => {
    const idempotencyKey = `${scenario.scenario}-${crypto.randomUUID()}`;
    setBusy(scenario.scenario);
    try {
      const response = await fetchWithAuth('/internal/fault-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ scenario: scenario.scenario, parameters, confirmed: true, idempotencyKey }),
      });
      const result = await response.json() as { code: number; message: string };
      if (!response.ok || result.code !== 0) throw new Error(result.message);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to create Fault Run');
    } finally {
      setBusy(null);
    }
  };

  const stopRun = async (run: FaultRun) => {
    if (!window.confirm(`Stop ${run.scenario}?`)) return;
    const idempotencyKey = `stop-${run.faultRunId}-${crypto.randomUUID()}`;
    setBusy(run.faultRunId);
    try {
      const response = await fetchWithAuth(`/internal/fault-runs/${run.faultRunId}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ confirmed: true }),
      });
      const result = await response.json() as { code: number; message: string };
      if (!response.ok || result.code !== 0) throw new Error(result.message);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to stop Fault Run');
    } finally {
      setBusy(null);
    }
  };

  const restartNotification = async (run: FaultRun) => {
    if (!window.confirm('Restart the fixed notification-service target?')) return;
    const idempotencyKey = `restart-${run.faultRunId}-${crypto.randomUUID()}`;
    setBusy(run.faultRunId);
    try {
      const response = await fetchWithAuth('/internal/traffic/services/notification/restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ faultRunId: run.faultRunId, confirmed: true }),
      });
      const result = await response.json() as { code: number; message: string };
      if (!response.ok || result.code !== 0) throw new Error(result.message);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to restart notification service');
    } finally {
      setBusy(null);
    }
  };

  const cleanupRun = async (run: FaultRun) => {
    if (!window.confirm(`Clean notification storage for run ${run.faultRunId.slice(0, 8)}?`)) return;
    const idempotencyKey = `cleanup-${run.faultRunId}-${crypto.randomUUID()}`;
    setBusy(run.faultRunId);
    try {
      const response = await fetchWithAuth(`/internal/fault-runs/${run.faultRunId}/cleanup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ confirmed: true }),
      });
      const result = await response.json() as { code: number; message: string };
      if (!response.ok || result.code !== 0) throw new Error(result.message);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to clean Fault Run resources');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
        <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">Operations console</p><h1 className="text-3xl font-semibold tracking-tight">Scenario control</h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Fixed targets, one active run at a time, and auditable recovery through the protected Fault Run API.</p></div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className={`status-dot ${activeRun ? 'status-dot-yellow' : 'status-dot-green'}`} />{activeRun ? `Active · ${activeRun.scenario}` : 'No active run'}</div>
      </section>
      {error && <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive"><AlertTriangle className="size-4" />{error}</div>}
      <div className="grid gap-3 sm:grid-cols-3"><Metric icon={<ShieldCheck className="size-4" />} label="Catalog scenarios" value={data ? String(data.scenarios.length) : '...'} /><Metric icon={<Activity className="size-4" />} label="Active run" value={activeRun ? activeRun.state : 'NONE'} /><Metric icon={<Clock3 className="size-4" />} label="Seven-day runs" value={data ? String(data.runs.length) : '...'} /></div>
      {activeRun && <ActiveRunBanner run={activeRun} remainingMs={new Date(activeRun.expiresAt).getTime() - now} onDetails={() => void openDetails(activeRun)} onStop={() => void stopRun(activeRun)} busy={busy === activeRun.faultRunId} />}
      {unavailableHeapRun && <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3"><div><p className="text-sm font-medium">Notification service unavailable</p><p className="mt-1 text-xs text-muted-foreground">Only a confirmed restart of the fixed notification-service target is allowed.</p></div><Button size="sm" onClick={() => void restartNotification(unavailableHeapRun)} disabled={busy === unavailableHeapRun.faultRunId}><ServerCog className="size-3.5" />{busy === unavailableHeapRun.faultRunId ? 'Restarting...' : 'Restart notification'}</Button></div>}
      {data && <ScenarioWorkspace scenarios={data.scenarios} selectedScenario={selectedScenario} setSelectedScenario={setSelectedScenario} activeRun={activeRun} busy={busy} onCreate={createRun} onDetails={openDetails} onStop={stopRun} />}
      {!data && !error && <div className="py-16 text-center text-sm text-muted-foreground"><RefreshCw className="mx-auto mb-3 size-5 animate-spin" />Loading scenario catalog...</div>}
      {data && <RunHistory runs={visibleRuns} scenarios={data.scenarios} filterState={filterState} filterScenario={filterScenario} setFilterState={setFilterState} setFilterScenario={setFilterScenario} onDetails={openDetails} onCleanup={cleanupRun} busy={busy} />}
      {selectedRun && <RunDetails details={selectedRun} onClose={() => setSelectedRun(null)} />}
    </div>
  );
}

function ScenarioWorkspace({ scenarios, selectedScenario, setSelectedScenario, activeRun, busy, onCreate, onDetails, onStop }: { scenarios: Scenario[]; selectedScenario: string; setSelectedScenario: (value: string) => void; activeRun?: FaultRun; busy: string | null; onCreate: (scenario: Scenario, parameters: Record<string, number | string>) => Promise<void>; onDetails: (run: FaultRun) => Promise<void>; onStop: (run: FaultRun) => Promise<void> }) {
  const scenario = scenarios.find((item) => item.scenario === selectedScenario) || scenarios[0];
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => Object.fromEntries(SCENARIO_GROUPS.map((group) => [group.label, group.scenarios.includes(scenario?.scenario || '')])));
  if (!scenario) return null;

  return <section className="grid min-h-[28rem] items-stretch gap-4 lg:grid-cols-[minmax(13rem,0.34fr)_minmax(0,0.66fr)]" aria-label="Scenario catalog">
    <div className="min-h-full rounded-lg border border-border bg-card/50 p-2">
      <div className="px-3 pb-2 pt-2"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Scenario catalog</p><p className="mt-1 text-xs text-muted-foreground">Select one scenario to configure.</p></div>
      <div className="flex gap-3 overflow-x-auto lg:block" role="tablist" aria-label="Scenarios">
        {SCENARIO_GROUPS.map((group) => {
          const items = group.scenarios.map((id) => scenarios.find((item) => item.scenario === id)).filter((item): item is Scenario => Boolean(item));
          if (items.length === 0) return null;
          const expanded = expandedGroups[group.label] ?? true;
          const activeGroup = group.scenarios.includes(scenario.scenario);
          return <div key={group.label} className="min-w-[14rem] lg:min-w-0">
            <button type="button" className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.14em] transition-colors ${activeGroup ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`} aria-expanded={expanded} onClick={() => setExpandedGroups((current) => ({ ...current, [group.label]: !expanded }))}><span>{group.label}</span><ChevronDown className={`size-3.5 transition-transform ${expanded ? '' : '-rotate-90'}`} /></button>
            {expanded && <div className="space-y-1 border-l border-border/70 pl-2">{items.map((item) => {
              const index = scenarios.indexOf(item);
              const meta = SCENARIO_META[item.scenario] || { label: item.scenario, description: '', icon: Activity, tone: 'text-primary' };
              const Icon = meta.icon;
              const active = item.scenario === scenario.scenario;
              return <button key={item.scenario} type="button" role="tab" aria-selected={active} className={`flex min-w-max items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm transition-colors lg:w-full ${active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`} onClick={() => setSelectedScenario(item.scenario)}><span className="font-mono text-[10px] opacity-70">{String(index + 1).padStart(2, '0')}</span><Icon className={`size-4 shrink-0 ${active ? '' : meta.tone}`} /><span>{meta.label}</span></button>;
            })}</div>}
          </div>;
        })}
      </div>
    </div>
    <ScenarioCardWithActions key={scenario.scenario} scenario={scenario} activeRun={activeRun} busy={busy === scenario.scenario || busy === activeRun?.faultRunId} onCreate={onCreate} onDetails={onDetails} onStop={onStop} />
  </section>;
}

function ActiveRunBanner({ run, remainingMs, onDetails, onStop, busy }: { run: FaultRun; remainingMs: number; onDetails: () => void; onStop: () => void; busy: boolean }) { return <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-primary/30 bg-primary/5 px-4 py-3"><div className="flex items-center gap-3"><span className="status-dot status-dot-yellow" /><div><p className="text-sm font-medium">Active run: {run.scenario}</p><p className="text-xs text-muted-foreground">{run.targetService} · {formatRemaining(remainingMs)} remaining · {run.faultRunId.slice(0, 8)}</p></div></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={onDetails}><Activity className="size-3.5" />Details</Button><Button variant="destructive" size="sm" onClick={onStop} disabled={busy}><Square className="size-3.5" />{busy ? 'Stopping...' : 'Stop'}</Button></div></div>; }
function RunHistory({ runs, scenarios, filterState, filterScenario, setFilterState, setFilterScenario, onDetails, onCleanup, busy }: { runs: FaultRun[]; scenarios: Scenario[]; filterState: string; filterScenario: string; setFilterState: (value: string) => void; setFilterScenario: (value: string) => void; onDetails: (run: FaultRun) => Promise<void>; onCleanup: (run: FaultRun) => Promise<void>; busy: string | null }) { return <Card><CardHeader className="flex flex-wrap items-center justify-between gap-3 space-y-0"><CardTitle className="text-sm">Recent runs · last 7 days</CardTitle><div className="flex gap-2"><select className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={filterState} onChange={(event) => setFilterState(event.target.value)}><option value="ALL">All states</option>{['CREATING', 'ACTIVE', 'RECOVERING', 'RECOVERED', 'STOPPED', 'FAILED', 'SERVICE_UNAVAILABLE'].map((state) => <option key={state} value={state}>{state}</option>)}</select><select className="h-8 max-w-52 rounded-md border border-input bg-background px-2 text-xs" value={filterScenario} onChange={(event) => setFilterScenario(event.target.value)}><option value="ALL">All scenarios</option>{scenarios.map((scenario) => <option key={scenario.scenario} value={scenario.scenario}>{scenario.scenario}</option>)}</select></div></CardHeader><CardContent>{runs.length === 0 ? <p className="text-sm text-muted-foreground">No matching runs.</p> : <div className="divide-y divide-border">{runs.map((run) => { const canCleanup = scenarios.find((scenario) => scenario.scenario === run.scenario)?.allowManualCleanup && ['RECOVERED', 'STOPPED'].includes(run.state); return <div key={run.faultRunId} className="flex w-full flex-wrap items-center justify-between gap-3 py-3"><button type="button" className="min-w-0 text-left hover:underline" onClick={() => void onDetails(run)}><span className="block text-sm font-medium">{run.scenario}</span><span className="mt-1 block text-xs text-muted-foreground">{run.targetService} · {formatTime(run.createdAt)}</span></button><span className="flex items-center gap-2"><Badge variant={run.state === 'ACTIVE' ? 'destructive' : 'secondary'}>{run.state}</Badge><span className="font-mono text-xs text-muted-foreground">{run.faultRunId.slice(0, 8)}</span>{canCleanup && <Button variant="outline" size="sm" onClick={() => void onCleanup(run)} disabled={busy === run.faultRunId}>Cleanup</Button>}</span></div>; })}</div>}</CardContent></Card>; }
function RunDetails({ details, onClose }: { details: FaultRunDetails; onClose: () => void }) { return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center"><div className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-lg border border-border bg-card shadow-xl"><div className="flex items-start justify-between border-b border-border p-5"><div><p className="text-xs uppercase tracking-wider text-muted-foreground">Fault Run details</p><h2 className="mt-1 text-lg font-semibold">{details.run.scenario}</h2><p className="mt-1 font-mono text-xs text-muted-foreground">{details.run.faultRunId}</p></div><Button variant="ghost" size="sm" onClick={onClose}>Close</Button></div><div className="grid gap-3 p-5 sm:grid-cols-4"><Detail label="State" value={details.run.state} /><Detail label="Target" value={details.run.targetService} /><Detail label="Expires" value={formatTime(details.run.expiresAt)} /><Detail label="Audit" value={details.run.operatorAuditId ? String(details.run.operatorAuditId) : 'Pending'} /></div><div className="border-t border-border px-5 py-4"><h3 className="mb-3 text-sm font-medium">Event timeline</h3>{details.events.length === 0 ? <p className="text-sm text-muted-foreground">No events recorded.</p> : <div className="space-y-3">{details.events.map((event) => <div key={event.id} className="flex gap-3 text-sm"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" /><div><p className="font-medium">{event.eventType}</p><p className="text-xs text-muted-foreground">{formatTime(event.createdAt)} · {eventSummary(event.payload)}</p></div></div>)}</div>}</div></div></div>; }
function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <Card><CardContent className="flex items-center gap-3 py-4"><span className="text-primary">{icon}</span><div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p></div></CardContent></Card>; }
function Detail({ label, value }: { label: string; value: string }) { return <div><p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-1 truncate text-sm font-medium">{value}</p></div>; }
function formatTime(value: string) { return new Date(value).toLocaleString('en-US', { timeZone: 'Asia/Shanghai', hour12: false }); }
function formatRemaining(milliseconds: number) { const seconds = Math.max(0, Math.ceil(milliseconds / 1000)); return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`; }
function eventSummary(payload: unknown) { if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'recorded'; const keys = Object.keys(payload); return keys.length ? `${keys.length} recorded fields` : 'recorded'; }
