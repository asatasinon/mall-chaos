'use client';

import { useState } from 'react';
import { Activity, Check, CheckCircle2, ChevronDown, Copy, Gauge, Hash, Square, Timer, Trash2, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import ScenarioCardWithActions from '@/components/ScenarioCardWithActions';
import { buildFaultRunView, formatBytes, formatHashNamespace, formatMemberSkus, summarizeFaultRunEvent } from '@/components/scenarios/fault-run-view';
import { getScenarioLabel, SCENARIO_GROUPS, SCENARIO_META } from '@/components/scenarios/meta';
import type { FaultRun, FaultRunDetails, Scenario } from '@/components/scenarios/types';
import { toast } from 'sonner';

interface ScenarioWorkspaceProps {
  scenarios: Scenario[];
  selectedScenario: string;
  setSelectedScenario: (value: string) => void;
  activeRun?: FaultRun;
  unavailableRun?: FaultRun;
  busy: string | null;
  onCreate: (scenario: Scenario, parameters: Record<string, number | string>) => Promise<void>;
  onDetails: (run: FaultRun) => Promise<void>;
  onStop: (run: FaultRun) => Promise<void>;
  onRestart?: (run?: FaultRun) => void;
}

export function ScenarioWorkspace({ scenarios, selectedScenario, setSelectedScenario, activeRun, unavailableRun, busy, onCreate, onDetails, onStop, onRestart }: ScenarioWorkspaceProps) {
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
    <ScenarioCardWithActions key={scenario.scenario} scenario={scenario} activeRun={activeRun} unavailableRun={unavailableRun} busy={busy === scenario.scenario || busy === activeRun?.faultRunId || busy === unavailableRun?.faultRunId} onCreate={onCreate} onDetails={onDetails} onStop={onStop} onRestart={onRestart} />
  </section>;
}

export function ActiveRunBanner({ run, remainingMs, onDetails, onStop, busy }: { run: FaultRun; remainingMs: number; onDetails: () => void; onStop: () => void; busy: boolean }) {
  return <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-primary/30 bg-primary/5 px-4 py-3"><div className="flex items-center gap-3"><span className="status-dot status-dot-yellow" /><div><p className="text-sm font-medium">Active run: {getScenarioLabel(run.scenario)}</p><p className="text-xs text-muted-foreground">{run.targetService} · {formatRemaining(remainingMs)} remaining · {run.faultRunId.slice(0, 8)}</p></div></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={onDetails}><Activity className="size-3.5" />Details</Button><Button variant="destructive" size="sm" onClick={onStop} disabled={busy}><Square className="size-3.5" />{busy ? 'Stopping...' : 'Stop'}</Button></div></div>;
}

export function RunHistory({ runs, scenarios, filterState, filterScenario, setFilterState, setFilterScenario, onDetails, onCleanup }: { runs: FaultRun[]; scenarios: Scenario[]; filterState: string; filterScenario: string; setFilterState: (value: string) => void; setFilterScenario: (value: string) => void; onDetails: (run: FaultRun) => Promise<void>; onCleanup: (run: FaultRun) => void | Promise<void> }) {
  return <Card><CardHeader className="flex flex-wrap items-center justify-between gap-3 space-y-0"><CardTitle className="text-sm">Recent runs · last 7 days</CardTitle><div className="flex gap-2"><label className="sr-only" htmlFor="run-state-filter">Filter by state</label><select id="run-state-filter" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={filterState} onChange={(event) => setFilterState(event.target.value)}><option value="ALL">All states</option>{['CREATING', 'ACTIVE', 'RECOVERING', 'RECOVERED', 'STOPPED', 'FAILED', 'SERVICE_UNAVAILABLE'].map((state) => <option key={state} value={state}>{state}</option>)}</select><label className="sr-only" htmlFor="run-scenario-filter">Filter by scenario</label><select id="run-scenario-filter" className="h-8 max-w-52 rounded-md border border-input bg-background px-2 text-xs" value={filterScenario} onChange={(event) => setFilterScenario(event.target.value)}><option value="ALL">All scenarios</option>{scenarios.map((scenario) => <option key={scenario.scenario} value={scenario.scenario}>{getScenarioLabel(scenario.scenario)}</option>)}</select></div></CardHeader><CardContent>{runs.length === 0 ? <p className="text-sm text-muted-foreground">No matching runs.</p> : <div className="divide-y divide-border">{runs.map((run) => {
    const scenario = scenarios.find((item) => item.scenario === run.scenario);
    const cleanupAvailable = Boolean(scenario?.allowManualCleanup && ['RECOVERED', 'STOPPED'].includes(run.state));
    return <div key={run.faultRunId} className="flex w-full flex-wrap items-center justify-between gap-3 py-3"><button type="button" className="min-w-0 text-left hover:underline" onClick={() => void onDetails(run)}><span className="block text-sm font-medium">{getScenarioLabel(run.scenario)}</span><span className="mt-1 block text-xs text-muted-foreground">{run.targetService} · {formatTime(run.createdAt)}</span></button><span className="flex flex-wrap items-center justify-end gap-2"><Badge variant={stateVariant(run.state)}>{run.state}</Badge><span className="font-mono text-xs text-muted-foreground">{run.faultRunId.slice(0, 8)}</span>{cleanupAvailable && <Button variant="outline" size="sm" onClick={() => void onCleanup(run)} title="Clean up this Fault Run"><Trash2 className="size-3.5" />Cleanup</Button>}</span></div>;
  })}</div>}</CardContent></Card>;
}

export function RunDetails({ details, onClose, onCleanup, allowManualCleanup = false }: { details: FaultRunDetails; onClose: () => void; onCleanup?: (run: FaultRun) => void | Promise<void>; allowManualCleanup?: boolean }) {
  const view = buildFaultRunView(details);
  const cleanupAvailable = allowManualCleanup && ['RECOVERED', 'STOPPED'].includes(details.run.state);
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 backdrop-blur-[2px] sm:items-center sm:p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="max-h-[92vh] w-full max-w-4xl overflow-auto rounded-xl border border-border bg-card shadow-[0_24px_80px_rgb(20_20_19_/_0.24)]" role="dialog" aria-modal="true" aria-labelledby="fault-run-details-title"><div className="sticky top-0 z-10 flex flex-wrap items-start justify-between gap-4 border-b border-border bg-card/95 p-5 backdrop-blur-sm"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Fault Run details</p><Badge variant={stateVariant(details.run.state)}>{details.run.state}</Badge></div><h2 id="fault-run-details-title" className="mt-2 text-xl font-semibold tracking-tight">{getScenarioLabel(details.run.scenario)}</h2><p className="mt-1 truncate font-mono text-xs text-muted-foreground">run/{details.run.faultRunId}</p></div><div className="flex items-center gap-2"><Button variant="ghost" size="sm" onClick={onClose}>Close</Button>{cleanupAvailable && onCleanup && <Button variant="outline" size="sm" onClick={() => void onCleanup(details.run)}><Trash2 className="size-3.5" />Cleanup run</Button>}</div></div><div className="space-y-5 p-5"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><ScenarioDetail label="Target" value={details.run.targetService} /><ScenarioDetail label="Operation" value={details.run.targetOperation} /><ScenarioDetail label="Expires" value={formatTime(details.run.expiresAt)} /><ScenarioDetail label="Audit" value={details.audit?.result ? `${details.audit.result} · #${details.audit.id}` : details.run.operatorAuditId ? `#${details.run.operatorAuditId}` : 'Pending'} /></div>{details.run.scenario === 'CATALOG_REDIS_LARGE_VALUE' && <RunParametersPanel run={details.run} />}{view.targetSummary && <TargetSummaryPanel details={details} view={view} />}{view.workerStats && <WorkerStatsPanel stats={view.workerStats} />}{view.drain && <DrainPanel drain={view.drain} />}{view.cleanup && <CleanupPanel cleanup={view.cleanup} />}{details.audit && <AuditPanel audit={details.audit} />}{details.run.recoveryError && <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">Recovery ended with a recorded error.</div>}<section aria-labelledby="fault-run-events-title" className="border-t border-border pt-5"><div className="mb-3 flex items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Audit trail</p><h3 id="fault-run-events-title" className="mt-1 text-sm font-medium">Event timeline</h3></div><span className="font-mono text-xs text-muted-foreground">{details.events.length} events</span></div>{details.events.length === 0 ? <p className="text-sm text-muted-foreground">No events recorded.</p> : <div className="space-y-2">{details.events.map((event) => <EventRow key={event.id} event={event} />)}</div>}</section></div></div></div>;
}

function TargetSummaryPanel({ details, view }: { details: FaultRunDetails; view: ReturnType<typeof buildFaultRunView> }) {
  const summary = view.targetSummary;
  const [copied, setCopied] = useState(false);
  if (!summary) return null;
  const hashKey = summary.hashKey;
  async function copyHashKey() {
    try {
      await navigator.clipboard.writeText(hashKey);
      setCopied(true);
      toast.success('Redis key copied');
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error('Unable to copy Redis key');
    }
  }

  return <section aria-labelledby="target-summary-title" className="overflow-hidden rounded-lg border border-primary/20 bg-primary/[0.035]"><div className="flex flex-wrap items-start justify-between gap-3 border-b border-primary/10 px-4 py-3"><div className="flex items-start gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><Hash className="size-4.5" /></span><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Target footprint</p><h3 id="target-summary-title" className="mt-1 text-sm font-medium">One Catalog Hash · {summary.memberCount} fields</h3></div></div><Badge variant="outline" className="border-primary/30 text-primary">{view.markerState === 'PUBLISHED' ? 'Marker published' : view.markerState === 'RELEASED' ? 'Marker released' : 'Marker unknown'}</Badge></div><div className="grid grid-cols-2 divide-x divide-y divide-primary/10 sm:grid-cols-4 sm:divide-y-0"><div className="min-w-0"><div className="flex items-center gap-1.5"><p className="text-[11px] uppercase tracking-wider text-muted-foreground">Namespace</p><Button type="button" variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-foreground" title={copied ? 'Redis key copied' : 'Copy full Redis key'} aria-label={copied ? 'Redis key copied' : 'Copy full Redis key'} onClick={() => void copyHashKey()}>{copied ? <Check /> : <Copy />}</Button></div><p className="mt-1 truncate font-mono text-sm font-medium" title={summary.hashKey}>{formatHashNamespace(summary.hashKey, details.run.faultRunId)}</p></div><ScenarioDetail label="Value size" value={formatBytes(summary.memberSizeBytes)} /><ScenarioDetail label="Logical bytes" value={formatBytes(summary.logicalBytes)} /><ScenarioDetail label="Observed bytes" value={formatBytes(summary.observedBytes)} /><ScenarioDetail label="Probe SKU" value={summary.probeSku} /><ScenarioDetail label="Safety TTL" value={`${summary.keyTtlSec}s`} /><ScenarioDetail label="Target expiry" value={summary.expiresAt ? formatTime(summary.expiresAt) : 'n/a'} /><ScenarioDetail label="Layout" value="HASH" /></div><div className="border-t border-primary/10 px-4 py-3"><p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Injected members</p><p className="mt-1 truncate font-mono text-xs text-foreground" title={summary.memberSkus.join(', ')}>{formatMemberSkus(summary)}</p></div></section>;
}

function RunParametersPanel({ run }: { run: FaultRun }) {
  const parameters = run.parameters ?? {};
  return <section aria-labelledby="run-parameters-title" className="rounded-lg border border-border bg-background/30 p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Run contract</p><h3 id="run-parameters-title" className="mt-1 text-sm font-medium">Submitted Catalog parameters</h3></div><Badge variant="secondary">server validated</Badge></div><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"><ScenarioDetail label="Duration" value={formatParameter(parameters.durationSec, 's')} /><ScenarioDetail label="Fields (N)" value={formatParameter(parameters.memberCount)} /><ScenarioDetail label="Value size (S)" value={formatParameter(parameters.memberSizeBytes, '', true)} /><ScenarioDetail label="Concurrency" value={formatParameter(parameters.concurrency)} /><ScenarioDetail label="Interval" value={formatParameter(parameters.requestIntervalMs, 'ms')} /><ScenarioDetail label="Safety TTL" value={formatParameter(parameters.keyTtlSec, 's')} /></div></section>;
}

function CleanupPanel({ cleanup }: { cleanup: NonNullable<ReturnType<typeof buildFaultRunView>['cleanup']> }) {
  const items = [
    ['Marker released', cleanup.released ?? cleanup.markerRemoved],
    ['Run Hash removed', cleanup.hashRemoved],
  ] as const;
  return <section aria-labelledby="cleanup-title" className="rounded-lg border border-border px-4 py-3"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Recovery footprint</p><h3 id="cleanup-title" className="mt-1 text-sm font-medium">Per-run cleanup result</h3></div><Badge variant={items.every(([, value]) => value !== false) ? 'secondary' : 'destructive'}>{items.every(([, value]) => value !== false) ? 'complete' : 'review'}</Badge></div><div className="mt-3 grid gap-2 sm:grid-cols-2">{items.map(([label, value]) => <div key={label} className="flex items-center justify-between gap-3 rounded-md bg-muted/35 px-3 py-2 text-xs"><span className="text-muted-foreground">{label}</span><span className={value === false ? 'font-medium text-destructive' : 'font-medium text-foreground'}>{value === undefined ? 'not reported' : value ? 'yes' : 'no'}</span></div>)}</div></section>;
}

function WorkerStatsPanel({ stats }: { stats: NonNullable<ReturnType<typeof buildFaultRunView>['workerStats']> }) {
  const cacheResults = Object.entries(stats.cacheResults).filter(([, count]) => typeof count === 'number' && count > 0);
  return <section aria-labelledby="worker-stats-title" className="rounded-lg border border-border bg-background/30 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Reader telemetry</p><h3 id="worker-stats-title" className="mt-1 text-sm font-medium">Bounded detail reads</h3></div><Badge variant="secondary">{stats.stopReason || 'running'}</Badge></div><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4"><TelemetryMetric icon={<Gauge className="size-3.5" />} label="Requests" value={String(stats.requests)} /><TelemetryMetric icon={<CheckCircle2 className="size-3.5" />} label="Successful" value={String(stats.successes)} /><TelemetryMetric icon={<XCircle className="size-3.5" />} label="Failed" value={String(stats.failures)} /><TelemetryMetric icon={<Timer className="size-3.5" />} label="Timeouts" value={String(stats.timeouts)} /></div><div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4"><TelemetryMetric label="Average" value={`${stats.averageLatencyMs} ms`} /><TelemetryMetric label="p50" value={`${stats.p50LatencyMs} ms`} /><TelemetryMetric label="p95" value={`${stats.p95LatencyMs} ms`} /><TelemetryMetric label="p99" value={`${stats.p99LatencyMs} ms`} /></div><div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground"><span className="font-medium text-foreground">Cache result</span>{cacheResults.length ? cacheResults.map(([key, count]) => <span key={key} className="font-mono">{key} <strong className="font-semibold text-foreground">{count}</strong></span>) : <span>none recorded</span>}</div></section>;
}

function DrainPanel({ drain }: { drain: NonNullable<ReturnType<typeof buildFaultRunView>['drain']> }) {
  return <section aria-labelledby="drain-title" className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 ${drain.drained ? 'border-emerald-500/30 bg-emerald-500/[0.06]' : 'border-destructive/30 bg-destructive/10'}`}><div className="flex items-center gap-3"><span className={drain.drained ? 'text-emerald-700 dark:text-emerald-300' : 'text-destructive'}>{drain.drained ? <CheckCircle2 className="size-5" /> : <XCircle className="size-5" />}</span><div><h3 id="drain-title" className="text-sm font-medium">Worker drain {drain.drained ? 'completed' : 'incomplete'}</h3><p className="mt-0.5 text-xs text-muted-foreground">{drain.registered ? 'Coordinator drain hook was registered before target cleanup.' : 'No Coordinator drain hook was recorded.'}</p></div></div>{drain.result && <span className="font-mono text-xs text-muted-foreground">inFlight={drain.result.inFlight}</span>}</section>;
}

function AuditPanel({ audit }: { audit: NonNullable<FaultRunDetails['audit']> }) {
  return <section aria-labelledby="operator-audit-title" className="grid gap-3 rounded-lg border border-border px-4 py-3 sm:grid-cols-4"><ScenarioDetail label="Operator audit" value={`#${audit.id}`} /><ScenarioDetail label="Result" value={audit.result} /><ScenarioDetail label="Action" value={audit.action} /><ScenarioDetail label="Recorded" value={formatTime(audit.createdAt)} /><span className="sr-only" id="operator-audit-title">Operator audit</span></section>;
}

function EventRow({ event }: { event: Parameters<typeof summarizeFaultRunEvent>[0] }) {
  const failed = event.eventType.includes('FAILED') || event.eventType === 'SCENARIO_REQUEST_FAILED';
  return <div className="flex gap-3 rounded-md border border-border/70 bg-background/20 px-3 py-2.5"><span className={`mt-0.5 ${failed ? 'text-destructive' : 'text-primary'}`}>{failed ? <XCircle className="size-4" /> : <CheckCircle2 className="size-4" />}</span><div className="min-w-0"><div className="flex flex-wrap items-center gap-x-2 gap-y-0.5"><p className="text-xs font-semibold tracking-wide">{event.eventType}</p><time className="text-[11px] text-muted-foreground" dateTime={event.createdAt}>{formatTime(event.createdAt)}</time></div><p className="mt-0.5 text-xs text-muted-foreground">{summarizeFaultRunEvent(event)}</p></div></div>;
}

function TelemetryMetric({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return <div className="min-w-0 rounded-md bg-muted/35 px-3 py-2"><div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{icon}<span>{label}</span></div><p className="mt-1 truncate text-sm font-semibold tabular-nums text-foreground">{value}</p></div>;
}

export function ScenarioMetric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <Card><CardContent className="flex items-center gap-3 py-4"><span className="text-primary">{icon}</span><div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p></div></CardContent></Card>;
}

function ScenarioDetail({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-1 truncate text-sm font-medium">{value}</p></div>;
}

function formatTime(value: string) {
  return new Date(value).toLocaleString('en-US', { timeZone: 'Asia/Shanghai', hour12: false });
}

function formatRemaining(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

function formatParameter(value: number | string | undefined, suffix = '', bytes = false): string {
  if (value === undefined || value === '') return 'n/a';
  if (!bytes) return `${value}${suffix}`;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? formatBytes(numeric) : String(value);
}

function stateVariant(state: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (['ACTIVE', 'FAILED', 'SERVICE_UNAVAILABLE'].includes(state)) return 'destructive';
  if (['RECOVERED', 'STOPPED'].includes(state)) return 'secondary';
  return 'outline';
}
