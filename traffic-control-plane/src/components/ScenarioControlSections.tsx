'use client';

import { useState } from 'react';
import { Activity, CheckCircle2, ChevronDown, Square } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import ScenarioCardWithActions from '@/components/ScenarioCardWithActions';
import { getScenarioLabel, SCENARIO_GROUPS, SCENARIO_META } from '@/components/scenarios/meta';
import type { FaultRun, FaultRunDetails, Scenario } from '@/components/scenarios/types';

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
  onCleanup: (scenario: Scenario) => Promise<void>;
  onRestart?: (run: FaultRun) => void;
}

export function ScenarioWorkspace({ scenarios, selectedScenario, setSelectedScenario, activeRun, unavailableRun, busy, onCreate, onDetails, onStop, onCleanup, onRestart }: ScenarioWorkspaceProps) {
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
    <ScenarioCardWithActions key={scenario.scenario} scenario={scenario} activeRun={activeRun} unavailableRun={unavailableRun} busy={busy === scenario.scenario || busy === activeRun?.faultRunId || busy === unavailableRun?.faultRunId || busy === `cleanup:${scenario.scenario}`} onCreate={onCreate} onDetails={onDetails} onStop={onStop} onCleanup={onCleanup} onRestart={onRestart} />
  </section>;
}

export function ActiveRunBanner({ run, remainingMs, onDetails, onStop, busy }: { run: FaultRun; remainingMs: number; onDetails: () => void; onStop: () => void; busy: boolean }) {
  return <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-primary/30 bg-primary/5 px-4 py-3"><div className="flex items-center gap-3"><span className="status-dot status-dot-yellow" /><div><p className="text-sm font-medium">Active run: {getScenarioLabel(run.scenario)}</p><p className="text-xs text-muted-foreground">{run.targetService} · {formatRemaining(remainingMs)} remaining · {run.faultRunId.slice(0, 8)}</p></div></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={onDetails}><Activity className="size-3.5" />Details</Button><Button variant="destructive" size="sm" onClick={onStop} disabled={busy}><Square className="size-3.5" />{busy ? 'Stopping...' : 'Stop'}</Button></div></div>;
}

export function RunHistory({ runs, scenarios, filterState, filterScenario, setFilterState, setFilterScenario, onDetails }: { runs: FaultRun[]; scenarios: Scenario[]; filterState: string; filterScenario: string; setFilterState: (value: string) => void; setFilterScenario: (value: string) => void; onDetails: (run: FaultRun) => Promise<void> }) {
  return <Card><CardHeader className="flex flex-wrap items-center justify-between gap-3 space-y-0"><CardTitle className="text-sm">Recent runs · last 7 days</CardTitle><div className="flex gap-2"><select className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={filterState} onChange={(event) => setFilterState(event.target.value)}><option value="ALL">All states</option>{['CREATING', 'ACTIVE', 'RECOVERING', 'RECOVERED', 'STOPPED', 'FAILED', 'SERVICE_UNAVAILABLE'].map((state) => <option key={state} value={state}>{state}</option>)}</select><select className="h-8 max-w-52 rounded-md border border-input bg-background px-2 text-xs" value={filterScenario} onChange={(event) => setFilterScenario(event.target.value)}><option value="ALL">All scenarios</option>{scenarios.map((scenario) => <option key={scenario.scenario} value={scenario.scenario}>{getScenarioLabel(scenario.scenario)}</option>)}</select></div></CardHeader><CardContent>{runs.length === 0 ? <p className="text-sm text-muted-foreground">No matching runs.</p> : <div className="divide-y divide-border">{runs.map((run) => <div key={run.faultRunId} className="flex w-full flex-wrap items-center justify-between gap-3 py-3"><button type="button" className="min-w-0 text-left hover:underline" onClick={() => void onDetails(run)}><span className="block text-sm font-medium">{getScenarioLabel(run.scenario)}</span><span className="mt-1 block text-xs text-muted-foreground">{run.targetService} · {formatTime(run.createdAt)}</span></button><span className="flex items-center gap-2"><Badge variant={run.state === 'ACTIVE' ? 'destructive' : 'secondary'}>{run.state}</Badge><span className="font-mono text-xs text-muted-foreground">{run.faultRunId.slice(0, 8)}</span></span></div>)}</div>}</CardContent></Card>;
}

export function RunDetails({ details, onClose }: { details: FaultRunDetails; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center"><div className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-lg border border-border bg-card shadow-xl"><div className="flex items-start justify-between border-b border-border p-5"><div><p className="text-xs uppercase tracking-wider text-muted-foreground">Fault Run details</p><h2 className="mt-1 text-lg font-semibold">{getScenarioLabel(details.run.scenario)}</h2><p className="mt-1 font-mono text-xs text-muted-foreground">{details.run.faultRunId}</p></div><Button variant="ghost" size="sm" onClick={onClose}>Close</Button></div><div className="grid gap-3 p-5 sm:grid-cols-4"><ScenarioDetail label="State" value={details.run.state} /><ScenarioDetail label="Target" value={details.run.targetService} /><ScenarioDetail label="Expires" value={formatTime(details.run.expiresAt)} /><ScenarioDetail label="Audit" value={details.run.operatorAuditId ? String(details.run.operatorAuditId) : 'Pending'} /></div><div className="border-t border-border px-5 py-4"><h3 className="mb-3 text-sm font-medium">Event timeline</h3>{details.events.length === 0 ? <p className="text-sm text-muted-foreground">No events recorded.</p> : <div className="space-y-3">{details.events.map((event) => <div key={event.id} className="flex gap-3 text-sm"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" /><div><p className="font-medium">{event.eventType}</p><p className="text-xs text-muted-foreground">{formatTime(event.createdAt)} · {eventSummary(event.payload)}</p></div></div>)}</div>}</div></div></div>;
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

function eventSummary(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'recorded';
  const keys = Object.keys(payload);
  return keys.length ? `${keys.length} recorded fields` : 'recorded';
}
