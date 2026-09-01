'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  AccountsPanel,
  ActivityPanel,
  LifecycleConfiguration,
  LifecycleStats,
  RunnerHeader,
  RunnerViewTabs,
} from '@/components/runner/RunnerPanels';
import { fetchWithAuth } from '@/lib/auth-fetch';
import type {
  AccountSummary,
  ActivityEntry,
  ConfigForm,
  LifecycleStep,
  RunnerConfig,
  RunnerStatus,
} from '@/components/runner/types';

export default function RunnerPage() {
  const [status, setStatus] = useState<RunnerStatus | null>(null);
  const [config, setConfig] = useState<RunnerConfig | null>(null);
  const [accountSummary, setAccountSummary] = useState<AccountSummary | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeView, setActiveView] = useState<'accounts' | 'activity'>('accounts');
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

  const loadAll = useCallback(async () => {
    await Promise.all([loadStatus(), loadConfig(), loadAccounts(), loadActivity()]);
  }, [loadAccounts, loadActivity, loadConfig, loadStatus]);

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
    return () => {
      clearInterval(statusTimer);
      clearInterval(activityTimer);
    };
  }, [loadActivity, loadAll, loadStatus]);

  const toggleEnabled = async () => {
    if (!config) return;
    try {
      const response = await fetchWithAuth('/internal/traffic/runner/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: config.version, enabled: !config.enabled }),
      });
      const json = await response.json();
      if (json.code !== 0) throw new Error(json.message || 'Unable to update lifecycle');
      toast.success(json.data.enabled ? 'Lifecycle enabled' : 'Lifecycle disabled');
      await loadConfig();
      await loadStatus();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to update lifecycle');
    }
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
      toast.success(`Saved at version ${json.data.newVersion}`);
      setEditing(false);
      await loadConfig();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Save failed');
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
      form={form}
      onEdit={() => setEditing(true)}
      onSave={() => void saveConfig()}
      onCancel={() => setEditing(false)}
      onFormChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
    />
    <RunnerViewTabs activeView={activeView} onChange={setActiveView} />

    {activeView === 'accounts' && <AccountsPanel accountSummary={accountSummary} accountError={accountError} onToggleAccount={(label, enabled) => void toggleAccount(label, enabled)} />}
    {activeView === 'activity' && <ActivityPanel activity={activity} expandedLifecycleId={expandedLifecycleId} lifecycleSteps={lifecycleSteps} onToggleLifecycle={(entry) => void toggleLifecycle(entry)} />}
  </div>;
}
