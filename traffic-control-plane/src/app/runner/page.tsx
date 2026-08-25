'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Check, Pause, Pencil, Play, Power, PowerOff, Save, X } from 'lucide-react';
import { fetchWithAuth } from '@/lib/auth-fetch';

interface RunnerStatus {
  running: boolean;
  enabled: boolean;
  paused: boolean;
  trafficMode: 'CUSTOMER_LIFECYCLE';
  lifecycleIntervalSec: number;
  configVersion: number;
  trafficRunId: string | null;
  currentLifecycleId: string | null;
  lastLifecycleStartedAt: string | null;
  lastLifecycleCompletedAt: string | null;
  lifecycleStartedCount: number;
  lifecycleCompletedCount: number;
  lifecycleNoopCount: number;
  lifecycleFailedCount: number;
  lifecycleInterruptedCount: number;
  averageIntervalSec: number | null;
}

interface RunnerConfig {
  version: number;
  enabled: boolean;
  trafficMode: 'CUSTOMER_LIFECYCLE';
  lifecycleIntervalSec: number;
  maxItems: number;
  maxItemQuantity: number;
  successfulPaymentRatio: number;
  couponUsageRatio: number;
  backgroundActionsEnabled: boolean;
}

interface ConfigForm {
  lifecycleIntervalSec: string;
  maxItems: string;
  maxItemQuantity: string;
  successfulPaymentRatio: string;
  couponUsageRatio: string;
}

interface AccountSummary {
  loginEnabled: boolean;
  count: number;
  enabledCount: number;
  accounts: Array<{ label: string; enabled: boolean; expectedCustomerId?: number }>;
}

interface ActivityEntry {
  ts: number;
  action: string;
  success: boolean;
  latencyMs: number;
  lifecycleId?: string;
  trafficRunId?: string;
  customerId?: number;
  orderId?: string;
  paymentId?: string;
  traceId?: string;
  faultScenarioId?: string;
  status?: string;
  errorCode?: string;
}

interface InventoryReplenishmentStatus {
  running: boolean;
  lastWindowId: string | null;
  lastResult: 'COMPLETED' | 'FAILED' | 'SKIPPED' | null;
  lastAttemptAt: string | null;
  nextExecutionAt: string | null;
  retryCount: number;
  lastAddedQuantity: number;
  lastSkippedCount: number;
  lastFailedCount: number;
}
interface CouponReplenishmentStatus {
  running: boolean; lastWindowId: string | null;
  lastResult: 'COMPLETED' | 'FAILED' | 'SKIPPED' | null;
  lastAttemptAt: string | null; nextExecutionAt: string | null; retryCount: number;
}

const INTERVALS = [60, 30, 20, 10];

export default function RunnerPage() {
  const [status, setStatus] = useState<RunnerStatus | null>(null);
  const [config, setConfig] = useState<RunnerConfig | null>(null);
  const [accountSummary, setAccountSummary] = useState<AccountSummary | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [inventory, setInventory] = useState<InventoryReplenishmentStatus | null>(null);
  const [couponReplenishment, setCouponReplenishment] = useState<CouponReplenishmentStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [expandedLifecycleId, setExpandedLifecycleId] = useState<string | null>(null);
  const [lifecycleSteps, setLifecycleSteps] = useState<Record<string, Array<Record<string, unknown>>>>({});
  const [form, setForm] = useState<ConfigForm>({
    lifecycleIntervalSec: '', maxItems: '', maxItemQuantity: '',
    successfulPaymentRatio: '', couponUsageRatio: '',
  });

  const loadAll = async () => {
    await Promise.all([
      loadStatus(), loadConfig(), loadAccounts(), loadActivity(), loadInventory(),
      loadCouponReplenishment(),
    ]);
  };

  const loadStatus = async () => {
    try {
      const response = await fetchWithAuth('/internal/traffic/runner/status');
      const json = await response.json();
      if (json.code === 0) setStatus(json.data);
    } catch {}
  };

  const loadConfig = async () => {
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
  };

  const loadAccounts = async () => {
    try {
      const response = await fetchWithAuth('/internal/traffic/runner/accounts');
      const json = await response.json();
      if (json.code === 0) setAccountSummary(json.data);
    } catch {}
  };

  const loadActivity = async () => {
    try {
      const response = await fetchWithAuth('/internal/traffic/runner/activity?limit=30');
      const json = await response.json();
      if (json.code === 0) setActivity(json.data);
    } catch {}
  };

  const loadInventory = async () => {
    try {
      const response = await fetchWithAuth('/internal/traffic/runner/inventory-replenishment/status');
      const json = await response.json();
      if (json.code === 0) setInventory(json.data);
    } catch {}
  };

  const loadCouponReplenishment = async () => {
    try {
      const response = await fetchWithAuth('/internal/traffic/runner/coupon-replenishment/status');
      const json = await response.json();
      if (json.code === 0) setCouponReplenishment(json.data);
    } catch {}
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
    void loadAll();
    const statusTimer = setInterval(() => void loadStatus(), 3000);
    const activityTimer = setInterval(() => void loadActivity(), 5000);
    const inventoryTimer = setInterval(() => void loadInventory(), 5000);
    const couponTimer = setInterval(() => void loadCouponReplenishment(), 5000);
    return () => {
      clearInterval(statusTimer);
      clearInterval(activityTimer);
      clearInterval(inventoryTimer);
      clearInterval(couponTimer);
    };
  }, []);

  const sendControl = async (path: string) => {
    await fetchWithAuth(path, { method: 'POST' });
    await loadStatus();
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

  const running = status?.running ?? false;
  const lifecycleResult = status
    ? `${status.lifecycleCompletedCount} completed / ${status.lifecycleFailedCount} failed`
    : '—';

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Customer Lifecycle</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Serial customer traffic and replenishment health</p>
        </div>
        <Badge variant={running ? 'default' : 'secondary'}>{running ? 'Running' : status?.paused ? 'Paused' : 'Stopped'}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric title="Interval" value={status ? `${status.lifecycleIntervalSec}s` : '—'} />
        <Metric title="Lifecycle result" value={lifecycleResult} />
        <Metric title="Average interval" value={status?.averageIntervalSec ? `${status.averageIntervalSec}s` : '—'} />
        <Metric title="Current lifecycle" value={status?.currentLifecycleId ? status.currentLifecycleId.slice(0, 8) : '—'} mono />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-sm font-medium">Lifecycle configuration</CardTitle>
          {!editing ? (
            <Button size="sm" variant="ghost" onClick={() => { setEditing(true); setMessage(null); }}><Pencil />Edit</Button>
          ) : (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={saveConfig} disabled={saving}><Save />{saving ? 'Saving...' : 'Save'}</Button>
              <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setMessage(null); }}><X />Cancel</Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {config?.enabled ? (
              <Button size="sm" variant="outline" onClick={toggleEnabled}><PowerOff />Disable</Button>
            ) : (
              <Button size="sm" onClick={toggleEnabled}><Power />Enable</Button>
            )}
            {config?.enabled && (status?.paused ? (
              <Button size="sm" variant="outline" onClick={() => void sendControl('/internal/traffic/runner/resume')}><Play />Resume</Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => void sendControl('/internal/traffic/runner/pause')}><Pause />Pause</Button>
            ))}
            {message && <span className="text-xs text-muted-foreground">{message}</span>}
          </div>
          {editing ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <SelectField label="Interval" value={form.lifecycleIntervalSec} options={INTERVALS.map(String)} onChange={(value) => setForm((current) => ({ ...current, lifecycleIntervalSec: value }))} />
              <NumberField label="Max items" value={form.maxItems} onChange={(value) => setForm((current) => ({ ...current, maxItems: value }))} />
              <NumberField label="Max quantity" value={form.maxItemQuantity} onChange={(value) => setForm((current) => ({ ...current, maxItemQuantity: value }))} />
              <NumberField label="Payment success %" value={form.successfulPaymentRatio} onChange={(value) => setForm((current) => ({ ...current, successfulPaymentRatio: value }))} />
              <NumberField label="Coupon usage %" value={form.couponUsageRatio} onChange={(value) => setForm((current) => ({ ...current, couponUsageRatio: value }))} />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <Metric title="Interval" value={config ? `${config.lifecycleIntervalSec}s` : '—'} />
              <Metric title="Max items" value={config ? String(config.maxItems) : '—'} />
              <Metric title="Max quantity" value={config ? String(config.maxItemQuantity) : '—'} />
              <Metric title="Payment success" value={config ? `${config.successfulPaymentRatio * 100}%` : '—'} />
              <Metric title="Coupon usage" value={config ? `${config.couponUsageRatio * 100}%` : '—'} />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm font-medium">Lifecycle accounts</CardTitle></CardHeader>
          <CardContent>
            {!accountSummary && <p className="text-sm text-muted-foreground">Loading...</p>}
            {accountSummary && <div className="space-y-2"><p className="text-xs text-muted-foreground">{accountSummary.loginEnabled ? `${accountSummary.enabledCount}/${accountSummary.count} enabled` : 'Login disabled'}</p><div className="flex flex-wrap gap-2">{accountSummary.accounts.map((account) => <Badge key={account.label} variant="outline"><span className={`status-dot mr-1.5 ${account.enabled ? 'status-dot-green' : 'status-dot-off'}`} />{account.label}{account.expectedCustomerId ? ` · ${account.expectedCustomerId}` : ''}</Badge>)}</div></div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm font-medium">Inventory replenishment</CardTitle></CardHeader>
          <CardContent>
            {!inventory && <p className="text-sm text-muted-foreground">Loading...</p>}
            {inventory && <div className="grid grid-cols-2 gap-3"><Metric title="Result" value={inventory.lastResult ?? 'pending'} /><Metric title="Window" value={inventory.lastWindowId ?? '—'} mono /><Metric title="Added" value={String(inventory.lastAddedQuantity)} /><Metric title="Retries" value={String(inventory.retryCount)} /></div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm font-medium">Coupon replenishment</CardTitle></CardHeader>
          <CardContent>
            {!couponReplenishment && <p className="text-sm text-muted-foreground">Loading...</p>}
            {couponReplenishment && <div className="grid grid-cols-2 gap-3"><Metric title="Result" value={couponReplenishment.lastResult ?? 'pending'} /><Metric title="Window" value={couponReplenishment.lastWindowId ?? '—'} mono /><Metric title="Next run" value={formatTimestamp(couponReplenishment.nextExecutionAt)} /><Metric title="Retries" value={String(couponReplenishment.retryCount)} /></div>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3"><CardTitle className="text-sm font-medium">Recent lifecycle activity</CardTitle><span className="text-xs text-muted-foreground">{activity.length} records</span></CardHeader>
        <CardContent>
          {activity.length === 0 && <p className="text-sm text-muted-foreground">No lifecycle activity yet.</p>}
          <div className="space-y-1">{activity.map((entry, index) => <div key={`${entry.ts}-${index}`}>
            <button type="button" className="flex w-full flex-wrap items-center gap-2 text-left text-xs" onClick={() => void toggleLifecycle(entry)} disabled={!entry.lifecycleId}>
              <span className="w-16 font-mono text-muted-foreground">{new Date(entry.ts).toISOString().slice(11, 19)}</span>
              <Badge variant="outline">{entry.action}</Badge>
              <span className={entry.success ? 'text-primary' : 'text-destructive'}>{entry.success ? <Check /> : 'x'}</span>
              {entry.customerId && <span className="text-muted-foreground">customer {entry.customerId}</span>}
              {entry.orderId && <span className="font-mono text-muted-foreground">order {entry.orderId}</span>}
              {entry.lifecycleId && <span className="font-mono text-muted-foreground">{entry.lifecycleId.slice(0, 8)}</span>}
              {entry.errorCode && <span className="font-mono text-destructive">{entry.errorCode}</span>}
            </button>
            {expandedLifecycleId === entry.lifecycleId && lifecycleSteps[entry.lifecycleId] && <div className="ml-20 mt-1 space-y-1 border-l border-border pl-3">{lifecycleSteps[entry.lifecycleId].map((step, stepIndex) => <div key={`${String(step.action_id)}-${stepIndex}`} className="flex flex-wrap gap-2 text-[11px] text-muted-foreground"><span className="font-mono">{String(step.action_type ?? 'STEP')}</span><span>{String(step.status ?? '—')}</span>{step.result_code != null && <span className="font-mono">{String(step.result_code)}</span>}{step.error_code != null && <span className="font-mono text-destructive">{String(step.error_code)}</span>}</div>)}</div>}
          </div>)}</div>
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ title, value, mono = false }: { title: string; value: string; mono?: boolean }) {
  return <div className="rounded-md bg-muted/40 px-3 py-2.5"><p className="mb-1 text-[11px] text-muted-foreground">{title}</p><p className={`text-lg font-semibold tabular-nums ${mono ? 'font-mono text-sm' : ''}`}>{value}</p></div>;
}

function formatTimestamp(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—';
}

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="space-y-1"><span className="text-xs text-muted-foreground">{label}</span><input type="number" min="0" max="100" value={value} onChange={(event) => onChange(event.target.value)} className="h-8 w-full rounded-md border border-border bg-input px-2 text-sm outline-none focus:ring-1 focus:ring-ring" /></label>;
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label className="space-y-1"><span className="text-xs text-muted-foreground">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="h-8 w-full rounded-md border border-border bg-input px-2 text-sm outline-none focus:ring-1 focus:ring-ring">{options.map((option) => <option key={option} value={option}>{option}s</option>)}</select></label>;
}
