'use client';

import { useEffect, useState } from 'react';
import {
  Activity, AlertTriangle, CheckCircle2, Clock3, DatabaseZap, Flame,
  LockKeyhole, Play, RefreshCw, ServerCog, ShieldCheck, Square, WalletCards,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchWithAuth } from '@/lib/auth-fetch';

type Parameter = { name: string; kind: 'integer' | 'number' | 'string'; required?: boolean; min?: number; max?: number; maxLength?: number };
type Scenario = { scenario: string; targetService: string; targetOperation: string; maxDurationSec: number; recoveryStrategy: string; allowManualCleanup: boolean; parameters: Parameter[] };
type FaultRun = { faultRunId: string; scenario: string; targetService: string; targetOperation: string; state: string; expiresAt: string; createdAt: string; operatorAuditId?: number | null };
type Event = { id: number; eventType: string; payload?: unknown; createdAt: string };
type ConsoleData = { scenarios: Scenario[]; runs: FaultRun[] };
type FaultRunDetails = { run: FaultRun; events: Event[] };

const ACTIVE_STATES = ['CREATING', 'ACTIVE', 'RECOVERING'];
const SCENARIO_META: Record<string, { label: string; description: string; icon: typeof Activity; tone: string }> = {
  BROWSE_REPORT_SQL: { label: '商品浏览慢报表', description: '复现商品浏览报表的历史扫描与执行计划差异。', icon: DatabaseZap, tone: 'text-amber-700 dark:text-amber-300' },
  ORDER_REPORT_SQL: { label: '订单查询慢报表', description: '观察客户今日订单报表的范围与明细聚合路径。', icon: DatabaseZap, tone: 'text-amber-700 dark:text-amber-300' },
  BROWSE_SURGE: { label: '商品浏览流量突增', description: '经 Gateway 以受控并发持续访问真实商品 API。', icon: Flame, tone: 'text-orange-700 dark:text-orange-300' },
  ORDER_QUERY_SURGE: { label: '订单查询流量突增', description: '使用合规演示客户持续访问客户订单查询。', icon: Flame, tone: 'text-orange-700 dark:text-orange-300' },
  CART_REDIS_LARGE_VALUE: { label: '购物车大值读取', description: '固定使用 Sam 演练购物车触发运行专属 Redis 读取。', icon: WalletCards, tone: 'text-emerald-700 dark:text-emerald-300' },
  CART_CATALOG_DEPENDENCY: { label: '加购目录依赖失败', description: '在 Cart 写入前控制固定商品校验依赖的响应。', icon: ServerCog, tone: 'text-rose-700 dark:text-rose-300' },
  NOTIFICATION_HEAP_PRESSURE: { label: '通知内存压力', description: '在真实通知处理路径中持续保留高基数对象。', icon: AlertTriangle, tone: 'text-red-700 dark:text-red-300' },
  NOTIFICATION_STORAGE_APPEND: { label: '通知存储追加', description: '在真实通知事务中追加运行专属可清理数据。', icon: DatabaseZap, tone: 'text-violet-700 dark:text-violet-300' },
  PROMOTION_LOCK_CONTENTION: { label: '优惠券预留竞争', description: '在准备好的过期预留上观察反向事务竞争。', icon: LockKeyhole, tone: 'text-cyan-700 dark:text-cyan-300' },
  INVENTORY_TABLE_EXCLUSIVE: { label: '库存表独占锁', description: '观察库存可用性报表在真实表锁下的阻塞。', icon: LockKeyhole, tone: 'text-cyan-700 dark:text-cyan-300' },
  PSP_PROVIDER_OUTCOME: { label: '支付提供方结果', description: '通过独立 PSP 观察拒付或超时后的支付状态。', icon: ShieldCheck, tone: 'text-blue-700 dark:text-blue-300' },
};

export default function OverviewPage() {
  const [data, setData] = useState<ConsoleData | null>(null);
  const [selectedRun, setSelectedRun] = useState<FaultRunDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filterState, setFilterState] = useState('ALL');
  const [filterScenario, setFilterScenario] = useState('ALL');
  const [now, setNow] = useState(() => Date.now());

  const load = async () => {
    try {
      const response = await fetchWithAuth('/internal/fault-runs');
      const result = await response.json() as { code: number; message: string; data: ConsoleData };
      if (!response.ok || result.code !== 0) throw new Error(result.message);
      setData(result.data);
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
    if (!window.confirm(`停止 ${run.scenario}？`)) return;
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
    if (!window.confirm('确认重启固定目标 notification-service？')) return;
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
    if (!window.confirm(`清理运行 ${run.faultRunId.slice(0, 8)} 的通知存储？`)) return;
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
        <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">Operations console</p><h1 className="text-3xl font-semibold tracking-tight">Scenario control</h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground">固定目标、单运行互斥、可追溯恢复。所有控制动作都经受保护的 Fault Run API。</p></div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className={`status-dot ${activeRun ? 'status-dot-yellow' : 'status-dot-green'}`} />{activeRun ? `运行中 · ${activeRun.scenario}` : '暂无活动运行'}</div>
      </section>
      {error && <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive"><AlertTriangle className="size-4" />{error}</div>}
      <div className="grid gap-3 sm:grid-cols-3"><Metric icon={<ShieldCheck className="size-4" />} label="固定场景" value={data ? String(data.scenarios.length) : '...'} /><Metric icon={<Activity className="size-4" />} label="活动运行" value={activeRun ? activeRun.state : 'NONE'} /><Metric icon={<Clock3 className="size-4" />} label="七日记录" value={data ? String(data.runs.length) : '...'} /></div>
      {activeRun && <ActiveRunBanner run={activeRun} remainingMs={new Date(activeRun.expiresAt).getTime() - now} onDetails={() => void openDetails(activeRun)} onStop={() => void stopRun(activeRun)} busy={busy === activeRun.faultRunId} />}
      {unavailableHeapRun && <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3"><div><p className="text-sm font-medium">通知服务不可用</p><p className="mt-1 text-xs text-muted-foreground">仅允许对固定 notification-service 执行确认式重启。</p></div><Button size="sm" onClick={() => void restartNotification(unavailableHeapRun)} disabled={busy === unavailableHeapRun.faultRunId}><ServerCog className="size-3.5" />{busy === unavailableHeapRun.faultRunId ? 'Restarting...' : 'Restart notification'}</Button></div>}
      <div className="grid gap-4 lg:grid-cols-2">{data?.scenarios.map((scenario) => <ScenarioCard key={scenario.scenario} scenario={scenario} activeRun={activeRun} busy={busy === scenario.scenario} onCreate={createRun} onDetails={openDetails} />)}</div>
      {!data && !error && <div className="py-16 text-center text-sm text-muted-foreground"><RefreshCw className="mx-auto mb-3 size-5 animate-spin" />Loading scenario catalog...</div>}
      {data && <RunHistory runs={visibleRuns} scenarios={data.scenarios} filterState={filterState} filterScenario={filterScenario} setFilterState={setFilterState} setFilterScenario={setFilterScenario} onDetails={openDetails} onCleanup={cleanupRun} busy={busy} />}
      {selectedRun && <RunDetails details={selectedRun} onClose={() => setSelectedRun(null)} />}
    </div>
  );
}

function ScenarioCard({ scenario, activeRun, busy, onCreate, onDetails }: { scenario: Scenario; activeRun?: FaultRun; busy: boolean; onCreate: (scenario: Scenario, parameters: Record<string, number | string>) => Promise<void>; onDetails: (run: FaultRun) => Promise<void> }) {
  const meta = SCENARIO_META[scenario.scenario] || { label: scenario.scenario, description: '固定场景', icon: Activity, tone: 'text-primary' };
  const Icon = meta.icon;
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(scenario.parameters.map((parameter) => [parameter.name, parameter.name === 'durationSec' ? '60' : ''])));
  const setValue = (name: string, value: string) => setValues((current) => ({ ...current, [name]: value }));
  const submit = async () => {
    const parameters = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== '').map(([key, value]) => [key, scenario.parameters.find((parameter) => parameter.name === key)?.kind === 'string' ? value : Number(value)]));
    await onCreate(scenario, parameters);
  };
  const locked = Boolean(activeRun);
  return <Card className={`overflow-hidden transition-opacity ${locked ? 'opacity-70' : ''}`}><CardHeader className="gap-3 border-b border-border/70 pb-4"><div className="flex items-start justify-between gap-4"><div className="flex gap-3"><span className={`mt-0.5 rounded-md bg-muted p-2 ${meta.tone}`}><Icon className="size-5" /></span><div><CardTitle className="text-base">{meta.label}</CardTitle><p className="mt-1 text-xs leading-5 text-muted-foreground">{meta.description}</p></div></div><Badge variant="outline">{scenario.recoveryStrategy}</Badge></div><div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground"><span>目标 <strong className="font-medium text-foreground">{scenario.targetService}</strong></span><span>操作 <strong className="font-medium text-foreground">{scenario.targetOperation}</strong></span><span>上限 <strong className="font-medium text-foreground">{scenario.maxDurationSec}s</strong></span></div></CardHeader><CardContent className="space-y-4 pt-4">{['BROWSE_REPORT_SQL', 'ORDER_REPORT_SQL'].includes(scenario.scenario) && <div className="grid grid-cols-3 gap-2 rounded-md bg-muted/50 p-3 text-[11px]"><Detail label="Data window" value="Today / 180-day partitions" /><Detail label="Baseline" value="Historical scan" /><Detail label="Fix status" value="Awaiting plan evidence" /></div>}<div className="grid grid-cols-2 gap-3">{scenario.parameters.map((parameter) => <label key={parameter.name} className="space-y-1.5 text-xs"><span className="flex justify-between gap-2 text-muted-foreground"><span>{parameter.name}</span><span>{parameter.required ? 'required' : 'optional'}</span></span><input className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" type={parameter.kind === 'string' ? 'text' : 'number'} min={parameter.min} max={parameter.max} maxLength={parameter.maxLength} value={values[parameter.name] || ''} onChange={(event) => setValue(parameter.name, event.target.value)} disabled={locked || busy} /></label>)}</div><div className="flex items-center justify-between gap-3"><span className="text-[11px] text-muted-foreground">{locked ? '已有活动运行，创建入口已锁定' : '参数由场景目录校验'}</span><Button size="sm" onClick={() => void submit()} disabled={locked || busy}><Play className="size-3.5" />{busy ? 'Starting...' : 'Start run'}</Button></div>{activeRun?.scenario === scenario.scenario && <button type="button" className="w-full border-t border-border pt-3 text-left text-xs text-primary hover:underline" onClick={() => void onDetails(activeRun)}>查看当前运行详情 <span aria-hidden="true">→</span></button>}</CardContent></Card>;
}

function ActiveRunBanner({ run, remainingMs, onDetails, onStop, busy }: { run: FaultRun; remainingMs: number; onDetails: () => void; onStop: () => void; busy: boolean }) { return <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-primary/30 bg-primary/5 px-4 py-3"><div className="flex items-center gap-3"><span className="status-dot status-dot-yellow" /><div><p className="text-sm font-medium">活动运行：{run.scenario}</p><p className="text-xs text-muted-foreground">{run.targetService} · 剩余 {formatRemaining(remainingMs)} · {run.faultRunId.slice(0, 8)}</p></div></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={onDetails}><Activity className="size-3.5" />Details</Button><Button variant="destructive" size="sm" onClick={onStop} disabled={busy}><Square className="size-3.5" />{busy ? 'Stopping...' : 'Stop'}</Button></div></div>; }
function RunHistory({ runs, scenarios, filterState, filterScenario, setFilterState, setFilterScenario, onDetails, onCleanup, busy }: { runs: FaultRun[]; scenarios: Scenario[]; filterState: string; filterScenario: string; setFilterState: (value: string) => void; setFilterScenario: (value: string) => void; onDetails: (run: FaultRun) => Promise<void>; onCleanup: (run: FaultRun) => Promise<void>; busy: string | null }) { return <Card><CardHeader className="flex flex-wrap items-center justify-between gap-3 space-y-0"><CardTitle className="text-sm">Recent runs · last 7 days</CardTitle><div className="flex gap-2"><select className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={filterState} onChange={(event) => setFilterState(event.target.value)}><option value="ALL">All states</option>{['CREATING', 'ACTIVE', 'RECOVERING', 'RECOVERED', 'STOPPED', 'FAILED', 'SERVICE_UNAVAILABLE'].map((state) => <option key={state} value={state}>{state}</option>)}</select><select className="h-8 max-w-52 rounded-md border border-input bg-background px-2 text-xs" value={filterScenario} onChange={(event) => setFilterScenario(event.target.value)}><option value="ALL">All scenarios</option>{scenarios.map((scenario) => <option key={scenario.scenario} value={scenario.scenario}>{scenario.scenario}</option>)}</select></div></CardHeader><CardContent>{runs.length === 0 ? <p className="text-sm text-muted-foreground">No matching runs.</p> : <div className="divide-y divide-border">{runs.map((run) => { const canCleanup = scenarios.find((scenario) => scenario.scenario === run.scenario)?.allowManualCleanup && ['RECOVERED', 'STOPPED'].includes(run.state); return <div key={run.faultRunId} className="flex w-full flex-wrap items-center justify-between gap-3 py-3"><button type="button" className="min-w-0 text-left hover:underline" onClick={() => void onDetails(run)}><span className="block text-sm font-medium">{run.scenario}</span><span className="mt-1 block text-xs text-muted-foreground">{run.targetService} · {formatTime(run.createdAt)}</span></button><span className="flex items-center gap-2"><Badge variant={run.state === 'ACTIVE' ? 'destructive' : 'secondary'}>{run.state}</Badge><span className="font-mono text-xs text-muted-foreground">{run.faultRunId.slice(0, 8)}</span>{canCleanup && <Button variant="outline" size="sm" onClick={() => void onCleanup(run)} disabled={busy === run.faultRunId}>Cleanup</Button>}</span></div>; })}</div>}</CardContent></Card>; }
function RunDetails({ details, onClose }: { details: FaultRunDetails; onClose: () => void }) { return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center"><div className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-lg border border-border bg-card shadow-xl"><div className="flex items-start justify-between border-b border-border p-5"><div><p className="text-xs uppercase tracking-wider text-muted-foreground">Fault Run details</p><h2 className="mt-1 text-lg font-semibold">{details.run.scenario}</h2><p className="mt-1 font-mono text-xs text-muted-foreground">{details.run.faultRunId}</p></div><Button variant="ghost" size="sm" onClick={onClose}>Close</Button></div><div className="grid gap-3 p-5 sm:grid-cols-4"><Detail label="State" value={details.run.state} /><Detail label="Target" value={details.run.targetService} /><Detail label="Expires" value={formatTime(details.run.expiresAt)} /><Detail label="Audit" value={details.run.operatorAuditId ? String(details.run.operatorAuditId) : 'Pending'} /></div><div className="border-t border-border px-5 py-4"><h3 className="mb-3 text-sm font-medium">Event timeline</h3>{details.events.length === 0 ? <p className="text-sm text-muted-foreground">No events recorded.</p> : <div className="space-y-3">{details.events.map((event) => <div key={event.id} className="flex gap-3 text-sm"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" /><div><p className="font-medium">{event.eventType}</p><p className="text-xs text-muted-foreground">{formatTime(event.createdAt)} · {eventSummary(event.payload)}</p></div></div>)}</div>}</div></div></div>; }
function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <Card><CardContent className="flex items-center gap-3 py-4"><span className="text-primary">{icon}</span><div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p></div></CardContent></Card>; }
function Detail({ label, value }: { label: string; value: string }) { return <div><p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-1 truncate text-sm font-medium">{value}</p></div>; }
function formatTime(value: string) { return new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }); }
function formatRemaining(milliseconds: number) { const seconds = Math.max(0, Math.ceil(milliseconds / 1000)); return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`; }
function eventSummary(payload: unknown) { if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'recorded'; const keys = Object.keys(payload); return keys.length ? `${keys.length} recorded fields` : 'recorded'; }
