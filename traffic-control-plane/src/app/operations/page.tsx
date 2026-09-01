'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import ConfirmDialog from '@/components/ConfirmDialog';
import DataControlPanel from '@/components/runner/RunnerDataControl';
import { RunnerTabButton } from '@/components/runner/RunnerControls';
import { ScheduledTasksPanel } from '@/components/runner/RunnerPanels';
import { fetchWithAuth } from '@/lib/auth-fetch';
import type {
  CouponReplenishmentStatus,
  InventoryReplenishmentStatus,
  RunnerStatus,
  WarmupCleanupConfirmation,
  WarmupJob,
  WarmupJobRequest,
  WarmupProgressResponse,
} from '@/components/runner/types';
import { todayInShanghaiClient } from '@/components/runner/utils';

type OperationsView = 'scheduled' | 'data';

export default function OperationsPage() {
  const [status, setStatus] = useState<RunnerStatus | null>(null);
  const [inventory, setInventory] = useState<InventoryReplenishmentStatus | null>(null);
  const [couponReplenishment, setCouponReplenishment] = useState<CouponReplenishmentStatus | null>(null);
  const [triggeringReplenishment, setTriggeringReplenishment] = useState<'inventory' | 'coupon' | null>(null);
  const [replenishmentMessages, setReplenishmentMessages] = useState<Record<'inventory' | 'coupon', string | null>>({
    inventory: null,
    coupon: null,
  });
  const [activeView, setActiveView] = useState<OperationsView>('scheduled');
  const [warmup, setWarmup] = useState<WarmupProgressResponse | null>(null);
  const [warmupJobs, setWarmupJobs] = useState<WarmupJob[]>([]);
  const [warmupLoading, setWarmupLoading] = useState(true);
  const [warmupJobsLoading, setWarmupJobsLoading] = useState(true);
  const [warmupError, setWarmupError] = useState<string | null>(null);
  const [warmupJobsError, setWarmupJobsError] = useState<string | null>(null);
  const warmupRequestInFlight = useRef(false);
  const warmupJobsRequestInFlight = useRef(false);
  const [warmupOperation, setWarmupOperation] = useState<'INJECT' | 'CLEANUP'>('INJECT');
  const [warmupTable, setWarmupTable] = useState('user_behavior_log');
  const [warmupRows, setWarmupRows] = useState('1000');
  const [warmupDateInput, setWarmupDateInput] = useState(() => todayInShanghaiClient());
  const [warmupDates, setWarmupDates] = useState<string[]>([]);
  const [warmupBusy, setWarmupBusy] = useState(false);
  const [warmupMessage, setWarmupMessage] = useState<string | null>(null);
  const [warmupCleanupConfirmation, setWarmupCleanupConfirmation] = useState<WarmupCleanupConfirmation | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetchWithAuth('/internal/traffic/runner/status');
      const json = await response.json();
      if (json.code === 0) setStatus(json.data);
    } catch {}
  }, []);

  const loadInventory = useCallback(async () => {
    try {
      const response = await fetchWithAuth('/internal/traffic/runner/inventory-replenishment/status');
      const json = await response.json();
      if (json.code === 0) setInventory(json.data);
    } catch {}
  }, []);

  const loadCouponReplenishment = useCallback(async () => {
    try {
      const response = await fetchWithAuth('/internal/traffic/runner/coupon-replenishment/status');
      const json = await response.json();
      if (json.code === 0) setCouponReplenishment(json.data);
    } catch {}
  }, []);

  const loadWarmupProgress = useCallback(async (showLoading = false) => {
    if (warmupRequestInFlight.current) return;
    warmupRequestInFlight.current = true;
    if (showLoading) setWarmupLoading(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetchWithAuth('/internal/traffic/runner/data-warmup/progress', { signal: controller.signal });
      const json = await response.json();
      if (json.code !== 0) throw new Error(json.message || `Warmup status request failed (${response.status})`);
      setWarmup(json.data as WarmupProgressResponse);
      setWarmupError(null);
    } catch (error) {
      setWarmupError(error instanceof Error && error.name === 'AbortError'
        ? 'Warmup status request timed out'
        : error instanceof Error ? error.message : 'Warmup status is unavailable');
    } finally {
      clearTimeout(timeout);
      warmupRequestInFlight.current = false;
      if (showLoading) setWarmupLoading(false);
    }
  }, []);

  const loadWarmupJobs = useCallback(async (showLoading = false) => {
    if (warmupJobsRequestInFlight.current) return;
    warmupJobsRequestInFlight.current = true;
    if (showLoading) setWarmupJobsLoading(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetchWithAuth('/internal/traffic/runner/data-warmup/jobs', { signal: controller.signal });
      const json = await response.json();
      if (json.code !== 0) throw new Error(json.message || `Manual queue request failed (${response.status})`);
      setWarmupJobs((json.data?.jobs ?? []) as WarmupJob[]);
      setWarmupJobsError(null);
    } catch (error) {
      setWarmupJobsError(error instanceof Error && error.name === 'AbortError'
        ? 'Manual queue request timed out'
        : error instanceof Error ? error.message : 'Manual queue is unavailable');
    } finally {
      clearTimeout(timeout);
      warmupJobsRequestInFlight.current = false;
      if (showLoading) setWarmupJobsLoading(false);
    }
  }, []);

  const loadAll = useCallback(async () => {
    await Promise.all([
      loadStatus(), loadInventory(), loadCouponReplenishment(), loadWarmupProgress(true), loadWarmupJobs(true),
    ]);
  }, [loadCouponReplenishment, loadInventory, loadStatus, loadWarmupJobs, loadWarmupProgress]);

  const triggerReplenishment = async (type: 'inventory' | 'coupon') => {
    setTriggeringReplenishment(type);
    setReplenishmentMessages((current) => ({ ...current, [type]: null }));
    try {
      const response = await fetchWithAuth(`/internal/traffic/runner/${type}-replenishment/trigger`, { method: 'POST' });
      const json = await response.json();
      if (json.code !== 0) throw new Error(json.message || 'Unable to run replenishment');
      if (type === 'inventory') {
        const result = json.data.result as InventoryReplenishmentStatus;
        setInventory(result);
        setReplenishmentMessages((current) => ({
          ...current,
          inventory: `Inventory replenishment completed: ${result.lastAddedQuantity} added, ${result.lastSkippedCount} skipped, ${result.lastFailedCount} failed`,
        }));
      } else {
        const result = json.data.result as CouponReplenishmentStatus;
        setCouponReplenishment(result);
        setReplenishmentMessages((current) => ({
          ...current,
          coupon: `Coupon replenishment completed: ${result.lastAddedCount} added, ${result.lastSkippedCount} skipped, ${result.lastFailedCount} failed`,
        }));
      }
    } catch (error) {
      setReplenishmentMessages((current) => ({
        ...current,
        [type]: error instanceof Error ? error.message : 'Unable to run replenishment',
      }));
    } finally {
      setTriggeringReplenishment(null);
    }
  };

  useEffect(() => {
    void Promise.resolve().then(() => loadAll());
    const statusTimer = setInterval(() => void loadStatus(), 3000);
    const inventoryTimer = setInterval(() => void loadInventory(), 5000);
    const couponTimer = setInterval(() => void loadCouponReplenishment(), 5000);
    const warmupTimer = setInterval(() => void loadWarmupProgress(), 3000);
    const warmupJobsTimer = setInterval(() => void loadWarmupJobs(), 3000);
    return () => {
      clearInterval(statusTimer);
      clearInterval(inventoryTimer);
      clearInterval(couponTimer);
      clearInterval(warmupTimer);
      clearInterval(warmupJobsTimer);
    };
  }, [loadAll, loadCouponReplenishment, loadInventory, loadStatus, loadWarmupJobs, loadWarmupProgress]);

  const addWarmupDates = (dates: string[]) => {
    if (dates.length === 0) return;
    setWarmupDates((current) => Array.from(new Set([...current, ...dates])).sort());
  };

  const queueWarmupJob = async ({ operation, tableName, dates, rowsPerDay }: WarmupJobRequest) => {
    setWarmupBusy(true);
    setWarmupMessage(null);
    try {
      const response = await fetchWithAuth('/internal/traffic/runner/data-warmup/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation, tableName, dates, rowsPerDay, confirmed: operation === 'CLEANUP' }),
      });
      const json = await response.json();
      if (json.code !== 0) throw new Error(json.message || 'Unable to queue data warmup job');
      setWarmupMessage(`Job #${json.data.jobId} queued`);
      setWarmupDates([]);
      await loadWarmupJobs(true);
    } catch (error) {
      setWarmupMessage(error instanceof Error ? error.message : 'Unable to queue data warmup job');
    } finally {
      setWarmupBusy(false);
    }
  };

  const submitWarmupJob = () => {
    if (warmupDates.length === 0) {
      setWarmupMessage('Select at least one date');
      return;
    }
    const request: WarmupJobRequest = {
      operation: warmupOperation,
      tableName: warmupTable,
      dates: [...warmupDates],
      rowsPerDay: warmupOperation === 'INJECT' ? Number(warmupRows) : 0,
    };
    if (request.operation === 'CLEANUP') {
      setWarmupCleanupConfirmation({ tableName: request.tableName, dates: request.dates });
      return;
    }
    void queueWarmupJob(request);
  };

  const workerUnavailable = status?.workerOnline === false;

  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Operations</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Scheduled replenishment and bounded data operations</p>
      </div>
      <Badge variant={workerUnavailable ? 'destructive' : 'secondary'}>
        {workerUnavailable ? 'Worker offline' : status ? 'Worker online' : 'Checking worker'}
      </Badge>
    </div>

    <div role="tablist" aria-label="Operations views" className="flex w-full items-center gap-5">
      <RunnerTabButton active={activeView === 'scheduled'} onClick={() => setActiveView('scheduled')}>Scheduled tasks</RunnerTabButton>
      <RunnerTabButton active={activeView === 'data'} onClick={() => setActiveView('data')}>Data control</RunnerTabButton>
    </div>

    {activeView === 'scheduled' && <ScheduledTasksPanel inventory={inventory} couponReplenishment={couponReplenishment} workerUnavailable={workerUnavailable} triggeringReplenishment={triggeringReplenishment} inventoryMessage={replenishmentMessages.inventory} couponMessage={replenishmentMessages.coupon} onTrigger={(type) => void triggerReplenishment(type)} />}
    {activeView === 'data' && <DataControlPanel
      warmup={warmup}
      jobs={warmupJobs}
      loading={warmupLoading}
      jobsLoading={warmupJobsLoading}
      error={warmupError}
      jobsError={warmupJobsError}
      operation={warmupOperation}
      tableName={warmupTable}
      rowsPerDay={warmupRows}
      dateInput={warmupDateInput}
      dates={warmupDates}
      busy={warmupBusy}
      message={warmupMessage}
      onRefresh={() => void loadWarmupProgress(true)}
      onRefreshJobs={() => void loadWarmupJobs(true)}
      onOperationChange={(operation) => { setWarmupOperation(operation); setWarmupMessage(null); }}
      onTableChange={setWarmupTable}
      onRowsChange={setWarmupRows}
      onDateInputChange={setWarmupDateInput}
      onAddDates={addWarmupDates}
      onRemoveDate={(date) => setWarmupDates((current) => current.filter((item) => item !== date))}
      onSubmit={submitWarmupJob}
    />}

    {warmupCleanupConfirmation && <ConfirmDialog
      title="Clear selected data partitions?"
      description={`Delete all data partitions for ${warmupCleanupConfirmation.dates.length} selected day(s) from ${warmupCleanupConfirmation.tableName}? This cannot be undone.`}
      confirmLabel="Confirm"
      confirmVariant="default"
      destructive
      onCancel={() => setWarmupCleanupConfirmation(null)}
      onConfirm={async () => {
        await queueWarmupJob({ operation: 'CLEANUP', tableName: warmupCleanupConfirmation.tableName, dates: warmupCleanupConfirmation.dates, rowsPerDay: 0 });
        setWarmupCleanupConfirmation(null);
      }}
    />}
  </div>;
}