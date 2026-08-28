'use client';

import { useCallback, useEffect, useState } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';
import DataControlPanel from '@/components/runner/RunnerDataControl';
import {
  AccountsPanel,
  ActivityPanel,
  LifecycleConfiguration,
  LifecycleStats,
  RunnerHeader,
  RunnerViewTabs,
  ScheduledTasksPanel,
} from '@/components/runner/RunnerPanels';
import { fetchWithAuth } from '@/lib/auth-fetch';
import type {
  AccountSummary,
  ActivityEntry,
  ConfigForm,
  CouponReplenishmentStatus,
  InventoryReplenishmentStatus,
  LifecycleStep,
  RunnerConfig,
  RunnerStatus,
  WarmupCleanupConfirmation,
  WarmupJobRequest,
  WarmupResponse,
} from '@/components/runner/types';
import { todayInShanghaiClient } from '@/components/runner/utils';

export default function RunnerPage() {
  const [status, setStatus] = useState<RunnerStatus | null>(null);
  const [config, setConfig] = useState<RunnerConfig | null>(null);
  const [accountSummary, setAccountSummary] = useState<AccountSummary | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [inventory, setInventory] = useState<InventoryReplenishmentStatus | null>(null);
  const [couponReplenishment, setCouponReplenishment] = useState<CouponReplenishmentStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [triggeringReplenishment, setTriggeringReplenishment] = useState<'inventory' | 'coupon' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'accounts' | 'scheduled' | 'data' | 'activity'>('accounts');
  const [warmup, setWarmup] = useState<WarmupResponse | null>(null);
  const [warmupOperation, setWarmupOperation] = useState<'INJECT' | 'CLEANUP'>('INJECT');
  const [warmupTable, setWarmupTable] = useState('user_behavior_log');
  const [warmupRows, setWarmupRows] = useState('1000');
  const [warmupDateInput, setWarmupDateInput] = useState(() => todayInShanghaiClient());
  const [warmupDates, setWarmupDates] = useState<string[]>([]);
  const [warmupBusy, setWarmupBusy] = useState(false);
  const [warmupMessage, setWarmupMessage] = useState<string | null>(null);
  const [warmupCleanupConfirmation, setWarmupCleanupConfirmation] = useState<WarmupCleanupConfirmation | null>(null);
  const [expandedLifecycleId, setExpandedLifecycleId] = useState<string | null>(null);
  const [lifecycleSteps, setLifecycleSteps] = useState<Record<string, LifecycleStep[]>>({});
  const [form, setForm] = useState<ConfigForm>({
    lifecycleIntervalSec: '',
    maxItems: '',
    maxItemQuantity: '',
    successfulPaymentRatio: '',
    couponUsageRatio: '',
  });

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetchWithAuth('/internal/traffic/runner/status');
      const json = await response.json();
      if (json.code === 0) setStatus(json.data);
    } catch {}
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const response = await fetchWithAuth('/internal/traffic/runner/config');
      const json = await response.json();
      if (json.code !== 0) return;
      const next = json.data as RunnerConfig;
      setConfig(next);
      setForm({
        lifecycleIntervalSec: String(next.lifecycleIntervalSec),
        maxItems: String(next.maxItems),
        maxItemQuantity: String(next.maxItemQuantity),
        successfulPaymentRatio: String(Math.round(next.successfulPaymentRatio * 100)),
        couponUsageRatio: String(Math.round(next.couponUsageRatio * 100)),
      });
    } catch {}
  }, []);

  const loadAccounts = useCallback(async () => {
    try {
      const response = await fetchWithAuth('/internal/traffic/runner/accounts');
      const json = await response.json();
      if (json.code === 0) {
        setAccountSummary(json.data);
        setAccountError(null);
      } else {
        setAccountError(json.message || 'Lifecycle account state is unavailable');
      }
    } catch {
      setAccountError('Lifecycle account state is unavailable');
    }
  }, []);

  const loadActivity = useCallback(async () => {
    try {
      const response = await fetchWithAuth('/internal/traffic/runner/activity?limit=30');
      const json = await response.json();
      if (json.code === 0) setActivity(json.data);
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

  const loadWarmup = useCallback(async () => {
    try {
      const response = await fetchWithAuth('/internal/traffic/runner/data-warmup/progress');
      const json = await response.json();
      if (json.code === 0) setWarmup(json.data as WarmupResponse);
    } catch {}
  }, []);

  const loadAll = useCallback(async () => {
    await Promise.all([
      loadStatus(), loadConfig(), loadAccounts(), loadActivity(), loadInventory(),
      loadCouponReplenishment(), loadWarmup(),
    ]);
  }, [loadAccounts, loadActivity, loadConfig, loadCouponReplenishment, loadInventory, loadStatus, loadWarmup]);

  const triggerReplenishment = async (type: 'inventory' | 'coupon') => {
    setTriggeringReplenishment(type);
    setMessage(null);
    try {
      const response = await fetchWithAuth(`/internal/traffic/runner/${type}-replenishment/trigger`, { method: 'POST' });
      const json = await response.json();
      if (json.code !== 0) throw new Error(json.message || 'Unable to queue replenishment');
      setMessage(`${type === 'inventory' ? 'Inventory' : 'Coupon'} replenishment queued`);
      await (type === 'inventory' ? loadInventory() : loadCouponReplenishment());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to queue replenishment');
    } finally {
      setTriggeringReplenishment(null);
    }
  };

  const toggleLifecycle = async (entry: ActivityEntry) => {
    if (!entry.lifecycleId || !entry.trafficRunId) return;
    if (expandedLifecycleId === entry.lifecycleId) {
      setExpandedLifecycleId(null);
      return;
    }
    setExpandedLifecycleId(entry.lifecycleId);
    if (lifecycleSteps[entry.lifecycleId]) return;
    try {
      const response = await fetchWithAuth(
        `/internal/traffic/runner/activity?trafficRunId=${encodeURIComponent(entry.trafficRunId)}&lifecycleId=${encodeURIComponent(entry.lifecycleId)}`,
      );
      const json = await response.json();
      if (json.code === 0) setLifecycleSteps((current) => ({ ...current, [entry.lifecycleId!]: json.data }));
    } catch {}
  };

  useEffect(() => {
    void Promise.resolve().then(() => loadAll());
    const statusTimer = setInterval(() => void loadStatus(), 3000);
    const activityTimer = setInterval(() => void loadActivity(), 5000);
    const inventoryTimer = setInterval(() => void loadInventory(), 5000);
    const couponTimer = setInterval(() => void loadCouponReplenishment(), 5000);
    const warmupTimer = setInterval(() => void loadWarmup(), 3000);
    return () => {
      clearInterval(statusTimer);
      clearInterval(activityTimer);
      clearInterval(inventoryTimer);
      clearInterval(couponTimer);
      clearInterval(warmupTimer);
    };
  }, [loadActivity, loadAll, loadCouponReplenishment, loadInventory, loadStatus, loadWarmup]);

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
      await loadWarmup();
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

  const toggleEnabled = async () => {
    if (!config) return;
    const response = await fetchWithAuth('/internal/traffic/runner/config', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: config.version, enabled: !config.enabled }),
    });
    const json = await response.json();
    setMessage(json.code === 0 ? (json.data.enabled ? 'Lifecycle enabled' : 'Lifecycle disabled') : json.message);
    await loadConfig();
    await loadStatus();
  };

  const saveConfig = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const response = await fetchWithAuth('/internal/traffic/runner/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: config.version,
          trafficMode: 'CUSTOMER_LIFECYCLE',
          lifecycleIntervalSec: Number(form.lifecycleIntervalSec),
          maxItems: Number(form.maxItems),
          maxItemQuantity: Number(form.maxItemQuantity),
          successfulPaymentRatio: Number(form.successfulPaymentRatio) / 100,
          couponUsageRatio: Number(form.couponUsageRatio) / 100,
        }),
      });
      const json = await response.json();
      if (json.code !== 0) throw new Error(json.message || 'Save failed');
      setMessage(`Saved at version ${json.data.newVersion}`);
      setEditing(false);
      await loadConfig();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const toggleAccount = async (label: string, enabled: boolean) => {
    try {
      const response = await fetchWithAuth('/internal/traffic/runner/accounts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, enabled }),
      });
      const json = await response.json();
      if (json.code === 0) {
        setAccountSummary(json.data);
        setAccountError(null);
      } else {
        setAccountError(json.message || 'Unable to update lifecycle account');
      }
    } catch {
      setAccountError('Unable to update lifecycle account');
    }
  };

  const running = status?.running ?? false;
  const workerUnavailable = status?.workerOnline === false;
  const lifecycleResult = status
    ? `${status.lifecycleCompletedCount} completed / ${status.lifecycleFailedCount} failed`
    : '—';

  return <div className="space-y-4">
    <RunnerHeader status={status} config={config} running={running} onToggleEnabled={() => void toggleEnabled()} />
    <LifecycleStats status={status} result={lifecycleResult} />
    <LifecycleConfiguration
      config={config}
      editing={editing}
      saving={saving}
      message={message}
      form={form}
      onEdit={() => { setEditing(true); setMessage(null); }}
      onSave={() => void saveConfig()}
      onCancel={() => { setEditing(false); setMessage(null); }}
      onFormChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
    />
    <RunnerViewTabs activeView={activeView} onChange={setActiveView} />

    {activeView === 'accounts' && <AccountsPanel accountSummary={accountSummary} accountError={accountError} onToggleAccount={(label, enabled) => void toggleAccount(label, enabled)} />}
    {activeView === 'scheduled' && <ScheduledTasksPanel inventory={inventory} couponReplenishment={couponReplenishment} workerUnavailable={workerUnavailable} triggeringReplenishment={triggeringReplenishment} onTrigger={(type) => void triggerReplenishment(type)} />}
    {activeView === 'data' && <DataControlPanel
      warmup={warmup}
      operation={warmupOperation}
      tableName={warmupTable}
      rowsPerDay={warmupRows}
      dateInput={warmupDateInput}
      dates={warmupDates}
      busy={warmupBusy}
      message={warmupMessage}
      onOperationChange={(operation) => { setWarmupOperation(operation); setWarmupMessage(null); }}
      onTableChange={setWarmupTable}
      onRowsChange={setWarmupRows}
      onDateInputChange={setWarmupDateInput}
      onAddDates={addWarmupDates}
      onRemoveDate={(date) => setWarmupDates((current) => current.filter((item) => item !== date))}
      onSubmit={submitWarmupJob}
    />}
    {activeView === 'activity' && <ActivityPanel activity={activity} expandedLifecycleId={expandedLifecycleId} lifecycleSteps={lifecycleSteps} onToggleLifecycle={(entry) => void toggleLifecycle(entry)} />}

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
