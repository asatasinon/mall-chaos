'use client';

import { Check, Pause, Pencil, Play, Power, PowerOff, RefreshCw, Save, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { NumberField, RunnerMetric, RunnerTabButton, SelectField } from '@/components/runner/RunnerControls';
import type {
  AccountSummary,
  ActivityEntry,
  ConfigForm,
  CouponReplenishmentStatus,
  InventoryReplenishmentStatus,
  LifecycleStep,
  RunnerConfig,
  RunnerStatus,
} from '@/components/runner/types';
import { formatTimestamp } from '@/components/runner/utils';

const INTERVALS = [60, 30, 20, 10];

type RunnerView = 'accounts' | 'scheduled' | 'data' | 'activity';

export function RunnerHeader({ status, config, running, onToggleEnabled }: { status: RunnerStatus | null; config: RunnerConfig | null; running: boolean; onToggleEnabled: () => void }) {
  return <div className="flex flex-wrap items-start justify-between gap-3">
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
        <Button size="sm" variant="outline" onClick={onToggleEnabled}><PowerOff />Stop</Button>
      ) : (
        <Button size="sm" onClick={onToggleEnabled}><Power />Start</Button>
      )}
    </div>
  </div>;
}

export function LifecycleStats({ status, result }: { status: RunnerStatus | null; result: string }) {
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
    <RunnerMetric title="Interval" value={status ? `${status.lifecycleIntervalSec}s` : '—'} />
    <RunnerMetric title="Lifecycle result" value={result} />
    <RunnerMetric title="Average interval" value={status?.averageIntervalSec ? `${status.averageIntervalSec}s` : '—'} />
    <RunnerMetric title="Current lifecycle" value={status?.currentLifecycleId ? status.currentLifecycleId.slice(0, 8) : '—'} mono />
  </div>;
}

interface LifecycleConfigurationProps {
  config: RunnerConfig | null;
  editing: boolean;
  saving: boolean;
  message: string | null;
  form: ConfigForm;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onFormChange: (patch: Partial<ConfigForm>) => void;
}

export function LifecycleConfiguration({ config, editing, saving, message, form, onEdit, onSave, onCancel, onFormChange }: LifecycleConfigurationProps) {
  return <Card className="!overflow-visible">
    <CardHeader className="!flex min-w-0 flex-row items-start justify-between gap-4 space-y-0 pb-3">
      <div className="min-w-0">
        <CardTitle className="text-sm font-medium">Lifecycle configuration</CardTitle>
        {config && <p className="mt-1 text-xs text-muted-foreground">Saved at version {config.version}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {!editing ? (
          <Button size="sm" variant="outline" onClick={onEdit}><Pencil />Edit</Button>
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={onSave} disabled={saving}><Save />{saving ? 'Saving...' : 'Save'}</Button>
            <Button size="sm" variant="ghost" onClick={onCancel}><X />Cancel</Button>
          </>
        )}
      </div>
    </CardHeader>
    <CardContent className="space-y-4">
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
      {editing ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <SelectField label="Interval" value={form.lifecycleIntervalSec} options={INTERVALS.map(String)} onChange={(value) => onFormChange({ lifecycleIntervalSec: value })} />
          <NumberField label="Max items" value={form.maxItems} onChange={(value) => onFormChange({ maxItems: value })} />
          <NumberField label="Max quantity" value={form.maxItemQuantity} onChange={(value) => onFormChange({ maxItemQuantity: value })} />
          <NumberField label="Payment success %" value={form.successfulPaymentRatio} onChange={(value) => onFormChange({ successfulPaymentRatio: value })} />
          <NumberField label="Coupon usage %" value={form.couponUsageRatio} onChange={(value) => onFormChange({ couponUsageRatio: value })} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <RunnerMetric title="Interval" value={config ? `${config.lifecycleIntervalSec}s` : '—'} />
          <RunnerMetric title="Max items" value={config ? String(config.maxItems) : '—'} />
          <RunnerMetric title="Max quantity" value={config ? String(config.maxItemQuantity) : '—'} />
          <RunnerMetric title="Payment success" value={config ? `${config.successfulPaymentRatio * 100}%` : '—'} />
          <RunnerMetric title="Coupon usage" value={config ? `${config.couponUsageRatio * 100}%` : '—'} />
        </div>
      )}
    </CardContent>
  </Card>;
}

export function RunnerViewTabs({ activeView, onChange }: { activeView: RunnerView; onChange: (view: RunnerView) => void }) {
  return <div role="tablist" aria-label="Runner views" className="flex w-full items-center gap-5">
    <RunnerTabButton active={activeView === 'accounts'} onClick={() => onChange('accounts')}>Accounts</RunnerTabButton>
    <RunnerTabButton active={activeView === 'scheduled'} onClick={() => onChange('scheduled')}>Scheduled tasks</RunnerTabButton>
    <RunnerTabButton active={activeView === 'data'} onClick={() => onChange('data')}>Data control</RunnerTabButton>
    <RunnerTabButton active={activeView === 'activity'} onClick={() => onChange('activity')}>Activity</RunnerTabButton>
  </div>;
}

export function AccountsPanel({ accountSummary, accountError, onToggleAccount }: { accountSummary: AccountSummary | null; accountError: string | null; onToggleAccount: (label: string, enabled: boolean) => void }) {
  return <Card id="runner-accounts" role="tabpanel">
    <CardHeader className="pb-3"><CardTitle className="text-sm font-medium">Lifecycle accounts</CardTitle></CardHeader>
    <CardContent>
      {!accountSummary && !accountError && <p className="text-sm text-muted-foreground">Loading...</p>}
      {accountError && <p className="text-sm text-destructive">{accountError}</p>}
      {accountSummary && <div className="space-y-2"><p className="text-xs text-muted-foreground">{accountSummary.enabledCount}/{accountSummary.count} enabled</p><div className="space-y-1">{accountSummary.accounts.map((account) => <div key={account.label} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"><div className="flex min-w-0 items-center gap-2 text-sm"><span className={`status-dot shrink-0 ${account.enabled ? 'status-dot-green' : 'status-dot-off'}`} />{account.label}{account.expectedCustomerId ? <span className="text-xs text-muted-foreground">customer {account.expectedCustomerId}</span> : null}</div><Button size="sm" variant="ghost" onClick={() => onToggleAccount(account.label, !account.enabled)}>{account.enabled ? <><Pause />Pause</> : <><Play />Enable</>}</Button></div>)}</div></div>}
    </CardContent>
  </Card>;
}

interface ScheduledTasksPanelProps {
  inventory: InventoryReplenishmentStatus | null;
  couponReplenishment: CouponReplenishmentStatus | null;
  workerUnavailable: boolean;
  triggeringReplenishment: 'inventory' | 'coupon' | null;
  inventoryMessage: string | null;
  couponMessage: string | null;
  onTrigger: (type: 'inventory' | 'coupon') => void;
}

export function ScheduledTasksPanel({ inventory, couponReplenishment, workerUnavailable, triggeringReplenishment, inventoryMessage, couponMessage, onTrigger }: ScheduledTasksPanelProps) {
  return <div id="runner-scheduled" role="tabpanel" className="grid gap-4 md:grid-cols-2">
    <Card>
      <CardHeader className="!flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <CardTitle className="text-sm font-medium">Inventory replenishment</CardTitle>
          <Badge variant={workerUnavailable || !inventory?.running ? 'secondary' : 'outline'}>{workerUnavailable ? 'Worker offline' : triggeringReplenishment === 'inventory' || inventory?.isExecuting ? 'Running' : inventory?.running ? 'Scheduled' : 'Stopped'}</Badge>
        </div>
        <Button size="sm" variant="outline" onClick={() => onTrigger('inventory')} disabled={triggeringReplenishment !== null}>
          <RefreshCw className={triggeringReplenishment === 'inventory' ? 'animate-spin' : ''} />Run now
        </Button>
      </CardHeader>
      <CardContent>
        {!inventory && <p className="text-sm text-muted-foreground">{workerUnavailable ? 'Worker unavailable' : 'Loading...'}</p>}
        {inventory && <div className="grid grid-cols-2 gap-3 xl:grid-cols-3"><RunnerMetric title="Result" value={triggeringReplenishment === 'inventory' || inventory.isExecuting ? 'RUNNING' : inventory.lastResult ?? 'PENDING'} /><RunnerMetric title="Window" value={inventory.lastWindowId ?? '—'} mono /><RunnerMetric title="Started" value={formatTimestamp(inventory.lastAttemptAt)} /><RunnerMetric title="Last completed" value={formatTimestamp(inventory.lastCompletedAt)} /><RunnerMetric title="Next run" value={formatTimestamp(inventory.nextExecutionAt)} /><RunnerMetric title="Added" value={String(inventory.lastAddedQuantity)} /><RunnerMetric title="Skipped" value={String(inventory.lastSkippedCount)} /><RunnerMetric title="Failed" value={String(inventory.lastFailedCount)} /><RunnerMetric title="Retries" value={String(inventory.retryCount)} /></div>}
        {inventoryMessage && <p className="mt-3 text-xs text-muted-foreground" role="status">{inventoryMessage}</p>}
      </CardContent>
    </Card>
    <Card>
      <CardHeader className="!flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <CardTitle className="text-sm font-medium">Coupon replenishment</CardTitle>
          <Badge variant={workerUnavailable || !couponReplenishment?.running ? 'secondary' : 'outline'}>{workerUnavailable ? 'Worker offline' : triggeringReplenishment === 'coupon' || couponReplenishment?.isExecuting ? 'Running' : couponReplenishment?.running ? 'Scheduled' : 'Stopped'}</Badge>
        </div>
        <Button size="sm" variant="outline" onClick={() => onTrigger('coupon')} disabled={triggeringReplenishment !== null}>
          <RefreshCw className={triggeringReplenishment === 'coupon' ? 'animate-spin' : ''} />Run now
        </Button>
      </CardHeader>
      <CardContent>
        {!couponReplenishment && <p className="text-sm text-muted-foreground">{workerUnavailable ? 'Worker unavailable' : 'Loading...'}</p>}
        {couponReplenishment && <div className="grid grid-cols-2 gap-3 xl:grid-cols-3"><RunnerMetric title="Result" value={triggeringReplenishment === 'coupon' || couponReplenishment.isExecuting ? 'RUNNING' : couponReplenishment.lastResult ?? 'PENDING'} /><RunnerMetric title="Window" value={couponReplenishment.lastWindowId ?? '—'} mono /><RunnerMetric title="Started" value={formatTimestamp(couponReplenishment.lastAttemptAt)} /><RunnerMetric title="Last completed" value={formatTimestamp(couponReplenishment.lastCompletedAt)} /><RunnerMetric title="Next run" value={formatTimestamp(couponReplenishment.nextExecutionAt)} /><RunnerMetric title="Added" value={String(couponReplenishment.lastAddedCount)} /><RunnerMetric title="Skipped" value={String(couponReplenishment.lastSkippedCount)} /><RunnerMetric title="Failed" value={String(couponReplenishment.lastFailedCount)} /><RunnerMetric title="Retries" value={String(couponReplenishment.retryCount)} /></div>}
        {couponMessage && <p className="mt-3 text-xs text-muted-foreground" role="status">{couponMessage}</p>}
      </CardContent>
    </Card>
  </div>;
}

interface ActivityPanelProps {
  activity: ActivityEntry[];
  expandedLifecycleId: string | null;
  lifecycleSteps: Record<string, LifecycleStep[]>;
  onToggleLifecycle: (entry: ActivityEntry) => void;
}

export function ActivityPanel({ activity, expandedLifecycleId, lifecycleSteps, onToggleLifecycle }: ActivityPanelProps) {
  return <Card id="runner-activity" role="tabpanel">
    <CardHeader className="!flex flex-row items-center justify-between space-y-0 pb-3"><CardTitle className="text-sm font-medium">Recent lifecycle activity</CardTitle><span className="text-xs text-muted-foreground">{activity.length} records</span></CardHeader>
    <CardContent>
      {activity.length === 0 && <p className="text-sm text-muted-foreground">No lifecycle activity yet.</p>}
      <div className="space-y-1">{activity.map((entry, index) => <div key={`${entry.ts}-${index}`}>
        <button type="button" className="flex w-full flex-wrap items-center gap-2 text-left text-xs" onClick={() => onToggleLifecycle(entry)} disabled={!entry.lifecycleId}>
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
  </Card>;
}
