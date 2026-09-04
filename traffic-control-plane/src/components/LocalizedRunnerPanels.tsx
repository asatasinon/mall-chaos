'use client';

import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Check, Pause, Pencil, Play, Power, PowerOff, RefreshCw, Save, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { NumberField, RunnerMetric, RunnerTabButton, SelectField } from '@/components/runner/RunnerControls';
import { LIFECYCLE_INTERVALS } from '@/lib/runner-config-constants';
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

type RunnerView = 'accounts' | 'activity';
type DisplayTranslator = (key: string) => string;

function displayStatus(value: string | null | undefined, translate: DisplayTranslator): string {
  if (!value) return translate('statusUnknown');
  const statusKeys: Record<string, string> = {
    RUNNING: 'statusRunning',
    PENDING: 'statusPending',
    COMPLETED: 'statusCompleted',
    FAILED: 'statusFailed',
    QUEUED: 'statusQueued',
    STOPPED: 'statusStopped',
    SCHEDULED: 'statusScheduled',
  };
  return statusKeys[value] ? translate(statusKeys[value]) : value;
}

export function RunnerHeader({ status, config, running, onToggleEnabled }: { status: RunnerStatus | null; config: RunnerConfig | null; running: boolean; onToggleEnabled: () => void }) {
  const t = useTranslations('Runner');
  return <div className="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="mt-0.5 text-sm text-muted-foreground">{t('subtitle')}</p>
      {status?.workerOnline === false && <p className="mt-1 text-xs text-destructive">{t('workerOfflineHelp')}</p>}
    </div>
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Badge variant={status?.workerOnline === false ? 'destructive' : running ? 'default' : 'secondary'}>
        {status?.workerOnline === false ? t('workerOffline') : running ? t('running') : t('stopped')}
      </Badge>
      {config?.enabled ? (
        <Button size="sm" variant="outline" onClick={onToggleEnabled}><PowerOff />{t('stopRunner')}</Button>
      ) : (
        <Button size="sm" onClick={onToggleEnabled}><Power />{t('startRunner')}</Button>
      )}
    </div>
  </div>;
}

export function LifecycleStats({ status, result }: { status: RunnerStatus | null; result: string }) {
  const t = useTranslations('Runner');
  const commonT = useTranslations('Common');
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
    <RunnerMetric title={t('interval')} value={status ? commonT('seconds', { count: status.lifecycleIntervalSec }) : '—'} />
    <RunnerMetric title={t('lifecycleResult')} value={result} />
    <RunnerMetric title={t('averageInterval')} value={status?.averageIntervalSec ? commonT('seconds', { count: status.averageIntervalSec }) : '—'} />
    <RunnerMetric title={t('currentLifecycle')} value={status?.currentLifecycleId ? status.currentLifecycleId.slice(0, 8) : '—'} mono />
  </div>;
}

interface LifecycleConfigurationProps {
  config: RunnerConfig | null;
  editing: boolean;
  saving: boolean;
  form: ConfigForm;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onFormChange: (patch: Partial<ConfigForm>) => void;
}

export function LifecycleConfiguration({ config, editing, saving, form, onEdit, onSave, onCancel, onFormChange }: LifecycleConfigurationProps) {
  const t = useTranslations('Runner');
  const commonT = useTranslations('Common');
  return <Card className="!overflow-visible">
    <CardHeader className="!flex min-w-0 flex-row items-start justify-between gap-4 space-y-0 pb-3">
      <div className="min-w-0">
        <CardTitle className="text-sm font-medium">{t('configuration')}</CardTitle>
        {config && <p className="mt-1 text-xs text-muted-foreground">{t('savedAtVersion', { version: config.version })}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {!editing ? (
          <Button size="sm" variant="outline" onClick={onEdit}><Pencil />{commonT('edit')}</Button>
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={onSave} disabled={saving}><Save />{saving ? commonT('saving') : commonT('save')}</Button>
            <Button size="sm" variant="ghost" onClick={onCancel}><X />{commonT('cancel')}</Button>
          </>
        )}
      </div>
    </CardHeader>
    <CardContent className="space-y-4">
      {editing ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <SelectField label={t('interval')} value={form.lifecycleIntervalSec} options={LIFECYCLE_INTERVALS.map(String)} onChange={(value) => onFormChange({ lifecycleIntervalSec: value })} />
          <NumberField label={t('maxItems')} value={form.maxItems} onChange={(value) => onFormChange({ maxItems: value })} />
          <NumberField label={t('maxQuantity')} value={form.maxItemQuantity} onChange={(value) => onFormChange({ maxItemQuantity: value })} />
          <NumberField label={t('paymentSuccessPercent')} value={form.successfulPaymentRatio} onChange={(value) => onFormChange({ successfulPaymentRatio: value })} />
          <NumberField label={t('couponUsagePercent')} value={form.couponUsageRatio} onChange={(value) => onFormChange({ couponUsageRatio: value })} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <RunnerMetric title={t('interval')} value={config ? commonT('seconds', { count: config.lifecycleIntervalSec }) : '—'} />
          <RunnerMetric title={t('maxItems')} value={config ? String(config.maxItems) : '—'} />
          <RunnerMetric title={t('maxQuantity')} value={config ? String(config.maxItemQuantity) : '—'} />
          <RunnerMetric title={t('paymentSuccessPercent')} value={config ? `${config.successfulPaymentRatio * 100}%` : '—'} />
          <RunnerMetric title={t('couponUsagePercent')} value={config ? `${config.couponUsageRatio * 100}%` : '—'} />
        </div>
      )}
    </CardContent>
  </Card>;
}

export function RunnerViewTabs({ activeView, onChange }: { activeView: RunnerView; onChange: (view: RunnerView) => void }) {
  const t = useTranslations('Runner');
  return <div role="tablist" aria-label={t('runnerViews')} className="flex w-full items-center gap-5">
    <RunnerTabButton active={activeView === 'activity'} onClick={() => onChange('activity')}>{t('activity')}</RunnerTabButton>
    <RunnerTabButton active={activeView === 'accounts'} onClick={() => onChange('accounts')}>{t('accounts')}</RunnerTabButton>
  </div>;
}

export function AccountsPanel({ accountSummary, accountError, onToggleAccount }: { accountSummary: AccountSummary | null; accountError: string | null; onToggleAccount: (label: string, enabled: boolean) => void }) {
  const t = useTranslations('Runner');
  const commonT = useTranslations('Common');
  return <Card id="runner-accounts" role="tabpanel">
    <CardHeader className="pb-3"><CardTitle className="text-sm font-medium">{t('lifecycleAccounts')}</CardTitle></CardHeader>
    <CardContent>
      {!accountSummary && !accountError && <p className="text-sm text-muted-foreground">{commonT('loading')}</p>}
      {accountError && <p className="text-sm text-destructive">{accountError}</p>}
      {accountSummary && <div className="space-y-2"><p className="text-xs text-muted-foreground">{t('enabledCount', { enabled: accountSummary.enabledCount, count: accountSummary.count })}</p><div className="space-y-1">{accountSummary.accounts.map((account) => <div key={account.label} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"><div className="flex min-w-0 items-center gap-2 text-sm"><span className={`status-dot shrink-0 ${account.enabled ? 'status-dot-green' : 'status-dot-off'}`} />{account.label}{account.expectedCustomerId ? <span className="text-xs text-muted-foreground">{t('accountCustomer', { id: account.expectedCustomerId })}</span> : null}</div><Button size="sm" variant="ghost" onClick={() => onToggleAccount(account.label, !account.enabled)}>{account.enabled ? <><Pause />{t('pause')}</> : <><Play />{t('enable')}</>}</Button></div>)}</div></div>}
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
  const t = useTranslations('Runner');
  const locale = useLocale();
  const commonT = useTranslations('Common');
  const statusLabel = (value: string | null | undefined) => displayStatus(value, (key) => t(key as never));
  const formatTime = (value: string | null | undefined) => formatTimestamp(value, locale, '—');
  const taskCard = (type: 'inventory' | 'coupon', data: InventoryReplenishmentStatus | CouponReplenishmentStatus | null, message: string | null) => {
    const isInventory = type === 'inventory';
    const running = isInventory ? (data as InventoryReplenishmentStatus | null)?.running : (data as CouponReplenishmentStatus | null)?.running;
    const executing = isInventory ? (data as InventoryReplenishmentStatus | null)?.isExecuting : (data as CouponReplenishmentStatus | null)?.isExecuting;
    const result = isInventory ? (data as InventoryReplenishmentStatus | null)?.lastResult : (data as CouponReplenishmentStatus | null)?.lastResult;
    const lastWindowId = data?.lastWindowId;
    const lastAttemptAt = data?.lastAttemptAt;
    const lastCompletedAt = data?.lastCompletedAt;
    const nextExecutionAt = data?.nextExecutionAt;
    const added = isInventory ? (data as InventoryReplenishmentStatus | null)?.lastAddedQuantity : (data as CouponReplenishmentStatus | null)?.lastAddedCount;
    const skipped = data?.lastSkippedCount;
    const failed = data?.lastFailedCount;
    const retries = data?.retryCount;
    const heading = isInventory ? t('inventoryReplenishment') : t('couponReplenishment');
    const triggerType = type;
    return <Card>
      <CardHeader className="!flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
        <div className="flex min-w-0 items-center gap-2"><CardTitle className="text-sm font-medium">{heading}</CardTitle><Badge variant={workerUnavailable || !running ? 'secondary' : 'outline'}>{workerUnavailable ? t('statusOffline') : triggeringReplenishment === triggerType || executing ? t('statusRunning') : running ? t('statusScheduled') : t('statusStopped')}</Badge></div>
        <Button size="sm" variant="outline" onClick={() => onTrigger(triggerType)} disabled={triggeringReplenishment !== null}><RefreshCw className={triggeringReplenishment === triggerType ? 'animate-spin' : ''} />{t('runNow')}</Button>
      </CardHeader>
      <CardContent>
        {!data && <p className="text-sm text-muted-foreground">{workerUnavailable ? t('workerUnavailable') : commonT('loading')}</p>}
        {data && <div className="grid grid-cols-2 gap-3 xl:grid-cols-3"><RunnerMetric title={t('runResult')} value={triggeringReplenishment === triggerType || executing ? t('statusRunning') : statusLabel(result ?? 'PENDING')} /><RunnerMetric title={t('window')} value={lastWindowId ?? '—'} mono /><RunnerMetric title={t('started')} value={formatTime(lastAttemptAt)} /><RunnerMetric title={t('lastCompleted')} value={formatTime(lastCompletedAt)} /><RunnerMetric title={t('nextRun')} value={formatTime(nextExecutionAt)} /><RunnerMetric title={t('added')} value={String(added ?? 0)} /><RunnerMetric title={t('skipped')} value={String(skipped ?? 0)} /><RunnerMetric title={t('failed')} value={String(failed ?? 0)} /><RunnerMetric title={t('retries')} value={String(retries ?? 0)} /></div>}
        {message && <p className="mt-3 text-xs text-muted-foreground" role="status">{message}</p>}
      </CardContent>
    </Card>;
  };
  return <div id="operations-scheduled" role="tabpanel" className="grid gap-4 md:grid-cols-2">{taskCard('inventory', inventory, inventoryMessage)}{taskCard('coupon', couponReplenishment, couponMessage)}</div>;
}

interface ActivityPanelProps {
  activity: ActivityEntry[];
  expandedLifecycleId: string | null;
  lifecycleSteps: Record<string, LifecycleStep[]>;
  onToggleLifecycle: (entry: ActivityEntry) => void;
}

export function ActivityPanel({ activity, expandedLifecycleId, lifecycleSteps, onToggleLifecycle }: ActivityPanelProps) {
  const t = useTranslations('Runner');
  const format = useFormatter();
  const display = (key: string) => t(key as never);
  return <Card id="runner-activity" role="tabpanel">
    <CardHeader className="!flex flex-row items-center justify-between space-y-0 pb-3"><CardTitle className="text-sm font-medium">{t('recentLifecycleActivity')}</CardTitle><span className="text-xs text-muted-foreground">{t('activityRecords', { count: activity.length })}</span></CardHeader>
    <CardContent>
      {activity.length === 0 && <p className="text-sm text-muted-foreground">{t('noLifecycleActivity')}</p>}
      <div className="space-y-1">{activity.map((entry, index) => <div key={`${entry.ts}-${index}`}>
        <button type="button" className="flex w-full flex-wrap items-center gap-2 text-left text-xs" onClick={() => onToggleLifecycle(entry)} disabled={!entry.lifecycleId}>
          <span className="w-16 font-mono text-muted-foreground">{format.dateTime(new Date(entry.ts), 'time')}</span>
          <Badge variant="outline">{entry.action}</Badge>
          <span className={entry.success ? 'text-primary' : 'text-destructive'}>{entry.success ? <Check /> : 'x'}</span>
          {entry.customerId && <span className="text-muted-foreground">{t('accountCustomer', { id: entry.customerId })}</span>}
          {entry.orderId && <span className="font-mono text-muted-foreground">{t('order', { id: entry.orderId })}</span>}
          {entry.lifecycleId && <span className="font-mono text-muted-foreground">{entry.lifecycleId.slice(0, 8)}</span>}
          {entry.errorCode && <span className="font-mono text-destructive">{entry.errorCode}</span>}
        </button>
        {expandedLifecycleId === entry.lifecycleId && lifecycleSteps[entry.lifecycleId] && <div className="ml-20 mt-1 space-y-1 border-l border-border pl-3">{lifecycleSteps[entry.lifecycleId].map((step, stepIndex) => <div key={`${String(step.action_id)}-${stepIndex}`} className="flex flex-wrap gap-2 text-[11px] text-muted-foreground"><span className="font-mono">{String(step.action_type ?? display('step'))}</span><span>{displayStatus(String(step.status ?? 'UNKNOWN'), display)}</span>{step.result_code != null && <span className="font-mono">{t('resultCode')}: {String(step.result_code)}</span>}{step.error_code != null && <span className="font-mono text-destructive">{t('errorCode')}: {String(step.error_code)}</span>}</div>)}</div>}
      </div>)}</div>
    </CardContent>
  </Card>;
}
