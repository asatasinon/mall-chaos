'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import ConfirmDialog from '@/components/ConfirmDialog';
import DataControlPanel from '@/components/runner/RunnerDataControl';
import { RunnerTabButton } from '@/components/runner/RunnerControls';
import { ScheduledTasksPanel } from '@/components/LocalizedRunnerPanels';
import { fetchWithAuth } from '@/lib/auth-fetch';
import { isClientNetworkError } from '@/lib/client-error';
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
  const t = useTranslations('Operations');
  const commonT = useTranslations('Common');
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
      if (json.code !== 0) throw new Error(json.message || t('warmupStatusRequestFailed', { status: response.status }));
      setWarmup(json.data as WarmupProgressResponse);
      setWarmupError(null);
    } catch (error) {
      setWarmupError(error instanceof Error && error.name === 'AbortError'
        ? t('warmupStatusTimedOut')
        : isClientNetworkError(error) ? commonT('networkError')
        : error instanceof Error ? error.message : t('warmupStatusUnavailable'));
    } finally {
      clearTimeout(timeout);
      warmupRequestInFlight.current = false;
      if (showLoading) setWarmupLoading(false);
    }
  }, [commonT, t]);

  const loadWarmupJobs = useCallback(async (showLoading = false) => {
    if (warmupJobsRequestInFlight.current) return;
    warmupJobsRequestInFlight.current = true;
    if (showLoading) setWarmupJobsLoading(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetchWithAuth('/internal/traffic/runner/data-warmup/jobs', { signal: controller.signal });
      const json = await response.json();
      if (json.code !== 0) throw new Error(json.message || t('manualQueueRequestFailed', { status: response.status }));
      setWarmupJobs((json.data?.jobs ?? []) as WarmupJob[]);
      setWarmupJobsError(null);
    } catch (error) {
      setWarmupJobsError(error instanceof Error && error.name === 'AbortError'
        ? t('manualQueueRequestTimedOut')
        : isClientNetworkError(error) ? commonT('networkError')
        : error instanceof Error ? error.message : t('manualQueueUnavailable'));
    } finally {
      clearTimeout(timeout);
      warmupJobsRequestInFlight.current = false;
      if (showLoading) setWarmupJobsLoading(false);
    }
  }, [commonT, t]);

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
      if (json.code !== 0) throw new Error(json.message || t('replenishmentRunFailed'));
      if (type === 'inventory') {
        const result = json.data.result as InventoryReplenishmentStatus;
        setInventory(result);
        setReplenishmentMessages((current) => ({
          ...current,
          inventory: t('replenishmentCompleted', { kind: t('inventoryReplenishment'), added: result.lastAddedQuantity, skipped: result.lastSkippedCount, failed: result.lastFailedCount }),
        }));
      } else {
        const result = json.data.result as CouponReplenishmentStatus;
        setCouponReplenishment(result);
        setReplenishmentMessages((current) => ({
          ...current,
          coupon: t('replenishmentCompleted', { kind: t('couponReplenishment'), added: result.lastAddedCount, skipped: result.lastSkippedCount, failed: result.lastFailedCount }),
        }));
      }
    } catch (error) {
      setReplenishmentMessages((current) => ({
        ...current,
        [type]: isClientNetworkError(error) ? commonT('networkError') : error instanceof Error ? error.message : t('replenishmentRunFailed'),
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
      if (json.code !== 0) throw new Error(json.message || t('unableToQueueWarmup'));
      setWarmupMessage(t('jobQueued', { id: json.data.jobId }));
      setWarmupDates([]);
      await loadWarmupJobs(true);
    } catch (error) {
      setWarmupMessage(isClientNetworkError(error) ? commonT('networkError') : error instanceof Error ? error.message : t('unableToQueueWarmup'));
    } finally {
      setWarmupBusy(false);
    }
  };

  const submitWarmupJob = () => {
    if (warmupDates.length === 0) {
      setWarmupMessage(t('selectAtLeastOneDate'));
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
        <h1 className="text-2xl font-semibold tracking-tight">{t('pageTitle')}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
      <Badge variant={workerUnavailable ? 'destructive' : 'secondary'}>
        {workerUnavailable ? t('statusWorkerOffline') : status ? t('workerOnline') : t('checkingWorker')}
      </Badge>
    </div>

    <div role="tablist" aria-label={t('operationsViews')} className="flex w-full items-center gap-5">
      <RunnerTabButton active={activeView === 'scheduled'} onClick={() => setActiveView('scheduled')}>{t('scheduledTasks')}</RunnerTabButton>
      <RunnerTabButton active={activeView === 'data'} onClick={() => setActiveView('data')}>{t('dataControl')}</RunnerTabButton>
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
      title={t('clearSelectedPartitions')}
      description={t('clearSelectedPartitionsDescription', { count: warmupCleanupConfirmation.dates.length, table: warmupCleanupConfirmation.tableName })}
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