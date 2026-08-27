'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CalendarDays, Check, ChevronDown, Database, Pencil, Pause, Play, Power, PowerOff, RefreshCw, Save, Trash2, X } from 'lucide-react';
import { fetchWithAuth } from '@/lib/auth-fetch';

interface RunnerStatus {
  running: boolean;
  workerOnline: boolean;
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

interface WarmupTable {
  tableName: string;
  status: string;
  actualRows: number;
  currentDate: string;
  dayTargetRows: number;
  dayCompletedRows: number;
  tableBytes: number;
  guardReason: string | null;
}

interface WarmupJob {
  id: number;
  operation: 'INJECT' | 'CLEANUP';
  tableName: string;
  dates: string[];
  rowsPerDay: number;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'PAUSED_GUARD';
  processedDays: number;
  processedRows: number;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface WarmupResponse {
  windowDays: number;
  rowsPerDay: number;
  targetRows: number;
  tables: WarmupTable[];
  jobs: WarmupJob[];
}

const INTERVALS = [60, 30, 20, 10];

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
  const [expandedLifecycleId, setExpandedLifecycleId] = useState<string | null>(null);
  const [lifecycleSteps, setLifecycleSteps] = useState<Record<string, Array<Record<string, unknown>>>>({});
  const [form, setForm] = useState<ConfigForm>({
    lifecycleIntervalSec: '', maxItems: '', maxItemQuantity: '',
    successfulPaymentRatio: '', couponUsageRatio: '',
  });

  const loadAll = async () => {
    await Promise.all([
      loadStatus(), loadConfig(), loadAccounts(), loadActivity(), loadInventory(),
      loadCouponReplenishment(), loadWarmup(),
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
      if (json.code === 0) {
        setAccountSummary(json.data);
        setAccountError(null);
      } else {
        setAccountError(json.message || 'Lifecycle account state is unavailable');
      }
    } catch {
      setAccountError('Lifecycle account state is unavailable');
    }
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

  const loadWarmup = async () => {
    try {
      const response = await fetchWithAuth('/internal/traffic/runner/data-warmup/progress');
      const json = await response.json();
      if (json.code === 0) setWarmup(json.data as WarmupResponse);
    } catch {}
  };

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
    void loadAll();
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
  }, []);

  const addWarmupDate = () => {
    if (!warmupDateInput || warmupDates.includes(warmupDateInput)) return;
    setWarmupDates((current) => [...current, warmupDateInput].sort());
  };

  const submitWarmupJob = async () => {
    if (warmupDates.length === 0) {
      setWarmupMessage('Select at least one date');
      return;
    }
    if (warmupOperation === 'CLEANUP' && !window.confirm(`Delete all data partitions for ${warmupDates.length} selected day(s)?`)) return;
    setWarmupBusy(true);
    setWarmupMessage(null);
    try {
      const response = await fetchWithAuth('/internal/traffic/runner/data-warmup/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: warmupOperation, tableName: warmupTable, dates: warmupDates, rowsPerDay: warmupOperation === 'INJECT' ? Number(warmupRows) : 0, confirmed: warmupOperation === 'CLEANUP' }),
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Customer Lifecycle</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Serial customer traffic and replenishment health</p>
          {status?.workerOnline === false && <p className="mt-1 text-xs text-destructive">Runner worker is not reporting. Check worker configuration and logs.</p>}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge variant={status?.workerOnline === false ? 'destructive' : running ? 'default' : 'secondary'}>
            {status?.workerOnline === false ? 'Worker offline' : running ? 'Running' : 'Stopped'}
          </Badge>
          {config?.enabled ? (
            <Button size="sm" variant="outline" onClick={toggleEnabled}><PowerOff />Stop</Button>
          ) : (
            <Button size="sm" onClick={toggleEnabled}><Power />Start</Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric title="Interval" value={status ? `${status.lifecycleIntervalSec}s` : '—'} />
        <Metric title="Lifecycle result" value={lifecycleResult} />
        <Metric title="Average interval" value={status?.averageIntervalSec ? `${status.averageIntervalSec}s` : '—'} />
        <Metric title="Current lifecycle" value={status?.currentLifecycleId ? status.currentLifecycleId.slice(0, 8) : '—'} mono />
      </div>

      <Card className="!overflow-visible">
        <CardHeader className="!flex min-w-0 flex-row items-start justify-between gap-4 space-y-0 pb-3">
          <div className="min-w-0">
            <CardTitle className="text-sm font-medium">Lifecycle configuration</CardTitle>
            {config && <p className="mt-1 text-xs text-muted-foreground">Saved at version {config.version}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!editing ? (
              <Button size="sm" variant="outline" onClick={() => { setEditing(true); setMessage(null); }}><Pencil />Edit</Button>
            ) : (
              <>
                <Button size="sm" variant="outline" onClick={saveConfig} disabled={saving}><Save />{saving ? 'Saving...' : 'Save'}</Button>
                <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setMessage(null); }}><X />Cancel</Button>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {message && <p className="text-xs text-muted-foreground">{message}</p>}
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

      <div role="tablist" aria-label="Runner views" className="flex w-full items-center gap-5">
        <TabButton active={activeView === 'accounts'} onClick={() => setActiveView('accounts')}>Accounts</TabButton>
        <TabButton active={activeView === 'scheduled'} onClick={() => setActiveView('scheduled')}>Scheduled tasks</TabButton>
        <TabButton active={activeView === 'data'} onClick={() => setActiveView('data')}>Data control</TabButton>
        <TabButton active={activeView === 'activity'} onClick={() => setActiveView('activity')}>Activity</TabButton>
      </div>

      {activeView === 'accounts' && <Card id="runner-accounts" role="tabpanel">
        <CardHeader className="pb-3"><CardTitle className="text-sm font-medium">Lifecycle accounts</CardTitle></CardHeader>
        <CardContent>
          {!accountSummary && !accountError && <p className="text-sm text-muted-foreground">Loading...</p>}
          {accountError && <p className="text-sm text-destructive">{accountError}</p>}
          {accountSummary && <div className="space-y-2"><p className="text-xs text-muted-foreground">{accountSummary.enabledCount}/{accountSummary.count} enabled</p><div className="space-y-1">{accountSummary.accounts.map((account) => <div key={account.label} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"><div className="flex min-w-0 items-center gap-2 text-sm"><span className={`status-dot shrink-0 ${account.enabled ? 'status-dot-green' : 'status-dot-off'}`} />{account.label}{account.expectedCustomerId ? <span className="text-xs text-muted-foreground">customer {account.expectedCustomerId}</span> : null}</div><Button size="sm" variant="ghost" onClick={() => void toggleAccount(account.label, !account.enabled)}>{account.enabled ? <><Pause />Pause</> : <><Play />Enable</>}</Button></div>)}</div></div>}
        </CardContent>
      </Card>}

      {activeView === 'scheduled' && <div id="runner-scheduled" role="tabpanel" className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="!flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
            <CardTitle className="text-sm font-medium">Inventory replenishment</CardTitle>
            <Button size="sm" variant="outline" onClick={() => void triggerReplenishment('inventory')} disabled={triggeringReplenishment !== null}>
              <RefreshCw className={triggeringReplenishment === 'inventory' ? 'animate-spin' : ''} />Run now
            </Button>
          </CardHeader>
          <CardContent>
            {!inventory && <p className="text-sm text-muted-foreground">{workerUnavailable ? 'Worker unavailable' : 'Loading...'}</p>}
            {inventory && <div className="grid grid-cols-2 gap-3"><Metric title="Result" value={inventory.lastResult ?? 'pending'} /><Metric title="Window" value={inventory.lastWindowId ?? '—'} mono /><Metric title="Added" value={String(inventory.lastAddedQuantity)} /><Metric title="Retries" value={String(inventory.retryCount)} /></div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="!flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
            <CardTitle className="text-sm font-medium">Coupon replenishment</CardTitle>
            <Button size="sm" variant="outline" onClick={() => void triggerReplenishment('coupon')} disabled={triggeringReplenishment !== null}>
              <RefreshCw className={triggeringReplenishment === 'coupon' ? 'animate-spin' : ''} />Run now
            </Button>
          </CardHeader>
          <CardContent>
            {!couponReplenishment && <p className="text-sm text-muted-foreground">{workerUnavailable ? 'Worker unavailable' : 'Loading...'}</p>}
            {couponReplenishment && <div className="grid grid-cols-2 gap-3"><Metric title="Result" value={couponReplenishment.lastResult ?? 'pending'} /><Metric title="Window" value={couponReplenishment.lastWindowId ?? '—'} mono /><Metric title="Next run" value={formatTimestamp(couponReplenishment.nextExecutionAt)} /><Metric title="Retries" value={String(couponReplenishment.retryCount)} /></div>}
          </CardContent>
        </Card>
      </div>}

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
        onAddDate={addWarmupDate}
        onRemoveDate={(date) => setWarmupDates((current) => current.filter((item) => item !== date))}
        onSubmit={() => void submitWarmupJob()}
      />}

      {activeView === 'activity' && <Card id="runner-activity" role="tabpanel">
        <CardHeader className="!flex flex-row items-center justify-between space-y-0 pb-3"><CardTitle className="text-sm font-medium">Recent lifecycle activity</CardTitle><span className="text-xs text-muted-foreground">{activity.length} records</span></CardHeader>
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
      </Card>}
    </div>
  );
}

function Metric({ title, value, mono = false }: { title: string; value: string; mono?: boolean }) {
  return <div className="rounded-md bg-muted/40 px-3 py-2.5"><p className="mb-1 text-[11px] text-muted-foreground">{title}</p><p className={`text-lg font-semibold tabular-nums ${mono ? 'font-mono text-sm' : ''}`}>{value}</p></div>;
}

function TabButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return <button type="button" role="tab" aria-selected={active} className={`relative inline-flex items-center gap-1 px-1 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${active ? 'text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-primary' : 'text-muted-foreground hover:text-foreground'}`} onClick={onClick}>{children}</button>;
}

function DataControlPanel({
  warmup, operation, tableName, rowsPerDay, dateInput, dates, busy, message,
  onOperationChange, onTableChange, onRowsChange, onDateInputChange, onAddDate, onRemoveDate, onSubmit,
}: {
  warmup: WarmupResponse | null;
  operation: 'INJECT' | 'CLEANUP';
  tableName: string;
  rowsPerDay: string;
  dateInput: string;
  dates: string[];
  busy: boolean;
  message: string | null;
  onOperationChange: (operation: 'INJECT' | 'CLEANUP') => void;
  onTableChange: (value: string) => void;
  onRowsChange: (value: string) => void;
  onDateInputChange: (value: string) => void;
  onAddDate: () => void;
  onRemoveDate: (date: string) => void;
  onSubmit: () => void;
}) {
  return <div className="space-y-4" id="runner-data-control" role="tabpanel">
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div><CardTitle className="text-sm font-medium">Data operation</CardTitle><p className="mt-1 text-xs text-muted-foreground">Queue a bounded operation for the standalone warmup worker.</p></div>
            <Database className="mt-0.5 size-4 text-primary" />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-2 rounded-md bg-muted/50 p-1">
            <ModeButton active={operation === 'INJECT'} onClick={() => onOperationChange('INJECT')}><Database />Inject rows</ModeButton>
            <ModeButton active={operation === 'CLEANUP'} onClick={() => onOperationChange('CLEANUP')}><Trash2 />Clear full days</ModeButton>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1"><span className="text-xs text-muted-foreground">Target table</span><TableSelect value={tableName} onChange={onTableChange} /></label>
            {operation === 'INJECT' && <label className="space-y-1"><span className="text-xs text-muted-foreground">Rows per selected day</span><input type="number" min="1" max="1000000" value={rowsPerDay} onChange={(event) => onRowsChange(event.target.value)} className="h-8 w-full rounded-md border border-border bg-input px-2 text-sm outline-none focus:ring-1 focus:ring-ring" /></label>}
          </div>
          <div className="space-y-2">
            <span className="text-xs text-muted-foreground">Selected dates</span>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative"><CalendarDays className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><input type="date" value={dateInput} onChange={(event) => onDateInputChange(event.target.value)} className="h-8 rounded-md border border-border bg-input pl-7 pr-2 text-sm outline-none focus:ring-1 focus:ring-ring" /></div>
              <Button size="sm" variant="outline" onClick={onAddDate}><CalendarDays />Add day</Button>
            </div>
            <div className="flex min-h-9 flex-wrap gap-1.5 rounded-md border border-dashed border-border p-2">
              {dates.length === 0 && <span className="text-xs text-muted-foreground">No days selected</span>}
              {dates.map((date) => <span key={date} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 font-mono text-xs">{date}<button type="button" aria-label={`Remove ${date}`} title={`Remove ${date}`} onClick={() => onRemoveDate(date)} className="text-muted-foreground hover:text-foreground"><X className="size-3" /></button></span>)}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            <p className="max-w-md text-xs text-muted-foreground">{operation === 'INJECT' ? 'Maximum 1,000,000 rows per day. The request is processed in batches.' : 'Clearing removes the entire partition for each selected day.'}</p>
            <Button onClick={onSubmit} disabled={busy || dates.length === 0}>{busy ? <><RefreshCw className="animate-spin" />Queuing...</> : operation === 'INJECT' ? <><Database />Queue injection</> : <><Trash2 />Queue cleanup</>}</Button>
          </div>
          {message && <p className="text-xs text-muted-foreground">{message}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm font-medium">Warmup window</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-2"><Metric title="Window" value={warmup ? `${warmup.windowDays} days` : '—'} /><Metric title="Default/day" value={warmup ? formatNumber(warmup.rowsPerDay) : '—'} /><Metric title="Target" value={warmup ? formatNumber(warmup.targetRows) : '—'} /></div>
          <div className="space-y-2">
            {warmup?.tables.map((table) => <div key={table.tableName} className="border-t border-border pt-2"><div className="flex items-center justify-between gap-2 text-xs"><span className="flex min-w-0 items-center gap-2 font-mono"><span className={`status-dot ${table.status === 'PAUSED_GUARD' || table.status === 'ERROR' ? 'status-dot-red' : table.status === 'APPENDING' ? 'status-dot-green' : 'status-dot-yellow'}`} />{table.tableName}</span><Badge variant={table.status === 'PAUSED_GUARD' ? 'destructive' : 'outline'}>{table.status}</Badge></div><div className="mt-1 grid grid-cols-3 gap-2 text-xs text-muted-foreground"><span>{formatNumber(table.actualRows)} rows</span><span>{formatNumber(table.dayCompletedRows)}/{formatNumber(table.dayTargetRows)} today</span><span className="text-right">{table.guardReason ?? formatBytes(table.tableBytes)}</span></div></div>)}
            {!warmup && <p className="text-sm text-muted-foreground">Loading warmup status...</p>}
          </div>
        </CardContent>
      </Card>
    </div>
    <Card>
      <CardHeader className="!flex flex-row items-center justify-between space-y-0 pb-3"><CardTitle className="text-sm font-medium">Manual operation queue</CardTitle><span className="text-xs text-muted-foreground">{warmup?.jobs.length ?? 0} recent</span></CardHeader>
      <CardContent>
        {!warmup?.jobs.length && <p className="text-sm text-muted-foreground">No manual operations yet.</p>}
        <div className="space-y-1">{warmup?.jobs.map((job) => <div key={job.id} className="grid gap-1 border-b border-border py-2 last:border-0 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:gap-3"><span className="font-mono text-xs text-muted-foreground">#{job.id}</span><div className="min-w-0 text-xs"><span className="font-medium">{job.operation === 'INJECT' ? 'Inject' : 'Clear'} {job.tableName}</span><span className="ml-2 text-muted-foreground">{job.dates.join(', ')}</span>{job.operation === 'INJECT' && <span className="ml-2 text-muted-foreground">{formatNumber(job.rowsPerDay)}/day</span>}{job.errorMessage && <p className="truncate text-destructive">{job.errorMessage}</p>}</div><div className="flex items-center gap-2 text-xs"><span className="text-muted-foreground">{job.operation === 'INJECT' ? `${formatNumber(job.processedRows)} rows` : `${job.processedDays}/${job.dates.length} days`}</span><Badge variant={job.status === 'FAILED' || job.status === 'PAUSED_GUARD' ? 'destructive' : job.status === 'COMPLETED' ? 'default' : 'outline'}>{job.status}</Badge></div></div>)}</div>
      </CardContent>
    </Card>
  </div>;
}

function ModeButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors ${active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{children}</button>;
}

function formatTimestamp(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—';
}

function todayInShanghaiClient(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatBytes(value: number): string {
  if (!value) return 'size pending';
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="space-y-1"><span className="text-xs text-muted-foreground">{label}</span><input type="number" min="0" max="100" value={value} onChange={(event) => onChange(event.target.value)} className="h-8 w-full rounded-md border border-border bg-input px-2 text-sm outline-none focus:ring-1 focus:ring-ring" /></label>;
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label className="space-y-1"><span className="text-xs text-muted-foreground">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="h-8 w-full rounded-md border border-border bg-input px-2 text-sm outline-none focus:ring-1 focus:ring-ring">{options.map((option) => <option key={option} value={option}>{option}s</option>)}</select></label>;
}

function TableSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const options = [
    { value: 'user_behavior_log', label: 'user_behavior_log', description: 'Customer activity partitions' },
    { value: 'product_price_history', label: 'product_price_history', description: 'Historical price snapshots' },
  ];
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [open]);

  return <div ref={containerRef} className="relative">
    <button type="button" className="flex h-8 w-full items-center justify-between rounded-md border border-border bg-input px-2.5 text-left text-sm outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }}>
      <span className={selected ? 'truncate text-foreground' : 'truncate text-muted-foreground'}>{selected?.label || value}</span>
      <ChevronDown className={`ml-2 size-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div className="absolute left-0 right-0 top-10 z-30 overflow-hidden rounded-md border border-border bg-popover p-1.5 text-popover-foreground shadow-lg" role="listbox" aria-label="Target tables">
      {options.map((option) => <button key={option.value} type="button" role="option" aria-selected={option.value === value} className="provider-option flex w-full items-center justify-between rounded px-2 py-2 text-left" onClick={() => { onChange(option.value); setOpen(false); }}>
        <span className="min-w-0"><span className="block truncate text-sm font-medium">{option.label}</span><span className="provider-option-detail block truncate text-[11px]">{option.description}</span></span>
        {option.value === value && <Check className="provider-option-check ml-3 size-4 shrink-0" />}
      </button>)}
    </div>}
  </div>;
}
