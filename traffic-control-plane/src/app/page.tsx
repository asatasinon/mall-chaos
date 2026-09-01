'use client';

import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, Clock3, ServerCog, ShieldCheck } from 'lucide-react';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import {
  ActiveRunBanner,
  RunDetails,
  RunHistory,
  ScenarioMetric,
  ScenarioWorkspace,
} from '@/components/ScenarioControlSections';
import { ACTIVE_STATES, getScenarioLabel, SCENARIO_META } from '@/components/scenarios/meta';
import type { ConsoleData, FaultRun, FaultRunDetails, Scenario } from '@/components/scenarios/types';
import { fetchWithAuth } from '@/lib/auth-fetch';
import { createClientId } from '@/lib/client-id';
import { listScenarioDefinitions } from '@/lib/fault-run-catalog';

const FALLBACK_DATA: ConsoleData = {
  scenarios: listScenarioDefinitions().map((scenario) => ({
    ...scenario,
    parameters: [...scenario.parameters],
  })),
  runs: [],
};

type ConfirmationRequest = {
  title: string;
  description: string;
  confirmLabel: string;
  action: () => Promise<void>;
  destructive?: boolean;
  confirmVariant?: 'default' | 'destructive';
};

export default function ScenarioControlPage() {
  const [data, setData] = useState<ConsoleData>(FALLBACK_DATA);
  const [selectedRun, setSelectedRun] = useState<FaultRunDetails | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null);
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
      const runningScenario = result.data.runs.find((run) => ACTIVE_STATES.includes(run.state))?.scenario;
      setData(result.data);
      setSelectedScenario((current) => current || runningScenario || result.data.scenarios[0]?.scenario || '');
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
    const idempotencyKey = `${scenario.scenario}-${createClientId()}`;
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

  const executeStop = async (run: FaultRun) => {
    const idempotencyKey = `stop-${run.faultRunId}-${createClientId()}`;
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

  const stopRun = async (run: FaultRun) => {
    setConfirmation({
      title: 'Stop active run?',
      description: `Stop ${getScenarioLabel(run.scenario)}? The run will begin its recovery flow.`,
      confirmLabel: 'Confirm',
      destructive: true,
      action: () => executeStop(run),
    });
  };

  const executeRestartNotification = async (run?: FaultRun) => {
    const busyKey = run?.faultRunId || 'NOTIFICATION_HEAP_PRESSURE';
    const idempotencyKey = `restart-${run?.faultRunId || 'notification-service'}-${createClientId()}`;
    setBusy(busyKey);
    try {
      const response = await fetchWithAuth('/internal/traffic/services/notification/restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ ...(run ? { faultRunId: run.faultRunId } : {}), confirmed: true }),
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

  const restartNotification = async (run?: FaultRun) => {
    setConfirmation({
      title: 'Restart notification service?',
      description: 'Check notification-service health and restart the fixed target only when it is unavailable.',
      confirmLabel: 'Confirm',
      destructive: true,
      action: () => executeRestartNotification(run),
    });
  };

  const executeCleanupScenario = async (scenario: Scenario) => {
    const idempotencyKey = `cleanup-scenario-${scenario.scenario}-${createClientId()}`;
    setBusy(`cleanup:${scenario.scenario}`);
    try {
      const response = await fetchWithAuth('/internal/fault-runs/cleanup-scenario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ scenario: scenario.scenario, confirmed: true }),
      });
      const result = await response.json() as { code: number; message: string };
      if (!response.ok || result.code !== 0) throw new Error(result.message);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to clean scenario data');
    } finally {
      setBusy(null);
    }
  };

  const cleanupScenario = async (scenario: Scenario) => {
    const scenarioLabel = SCENARIO_META[scenario.scenario]?.label || scenario.scenario;
    setConfirmation({
      title: 'Clean scenario data?',
      description: `Clean all data created by ${scenarioLabel}? This cannot be undone.`,
      confirmLabel: 'Confirm',
      destructive: true,
      confirmVariant: 'default',
      action: () => executeCleanupScenario(scenario),
    });
  };

  return <div className="mx-auto max-w-7xl space-y-6">
    <section className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
      <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">Operations console</p><h1 className="text-3xl font-semibold tracking-tight">Scenario control</h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Fixed targets, one active run at a time, and auditable recovery through the protected Fault Run API.</p></div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className={`status-dot ${activeRun ? 'status-dot-yellow' : 'status-dot-green'}`} />{activeRun ? `Active · ${getScenarioLabel(activeRun.scenario)}` : 'No active run'}</div>
    </section>
    {error && <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive"><AlertTriangle className="size-4" />{error}</div>}
    <div className="grid gap-3 sm:grid-cols-3"><ScenarioMetric icon={<ShieldCheck className="size-4" />} label="Catalog scenarios" value={data ? String(data.scenarios.length) : '...'} /><ScenarioMetric icon={<Activity className="size-4" />} label="Active run" value={activeRun ? activeRun.state : 'NONE'} /><ScenarioMetric icon={<Clock3 className="size-4" />} label="Seven-day runs" value={data ? String(data.runs.length) : '...'} /></div>
    {activeRun && <ActiveRunBanner run={activeRun} remainingMs={new Date(activeRun.expiresAt).getTime() - now} onDetails={() => void openDetails(activeRun)} onStop={() => void stopRun(activeRun)} busy={busy === activeRun.faultRunId} />}
    {unavailableHeapRun && <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3"><div><p className="text-sm font-medium">Notification service unavailable</p><p className="mt-1 text-xs text-muted-foreground">Only a confirmed restart of the fixed notification-service target is allowed.</p></div><Button size="sm" onClick={() => void restartNotification(unavailableHeapRun)} disabled={busy === unavailableHeapRun.faultRunId}><ServerCog className="size-3.5" />{busy === unavailableHeapRun.faultRunId ? 'Restarting...' : 'Restart notification'}</Button></div>}
    <ScenarioWorkspace key={selectedScenario || 'scenario-workspace'} scenarios={data.scenarios} selectedScenario={selectedScenario} setSelectedScenario={setSelectedScenario} activeRun={activeRun} unavailableRun={unavailableHeapRun} busy={busy} onCreate={createRun} onDetails={openDetails} onStop={stopRun} onCleanup={cleanupScenario} onRestart={restartNotification} />
    <RunHistory runs={visibleRuns} scenarios={data.scenarios} filterState={filterState} filterScenario={filterScenario} setFilterState={setFilterState} setFilterScenario={setFilterScenario} onDetails={openDetails} />
    {selectedRun && <RunDetails details={selectedRun} onClose={() => setSelectedRun(null)} />}
    {confirmation && <ConfirmDialog title={confirmation.title} description={confirmation.description} confirmLabel={confirmation.confirmLabel} confirmVariant={confirmation.confirmVariant} destructive={confirmation.destructive} onCancel={() => setConfirmation(null)} onConfirm={async () => { await confirmation.action(); setConfirmation(null); }} />}
  </div>;
}
