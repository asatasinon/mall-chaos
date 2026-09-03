'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Database, RefreshCw, Trash2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import DatePicker from '@/components/runner/DatePicker';
import { ModeButton, RunnerMetric, TableSelect } from '@/components/runner/RunnerControls';
import type { WarmupJob, WarmupProgressResponse } from '@/components/runner/types';
import { formatBytes, formatNumber } from '@/components/runner/utils';

interface DataControlPanelProps {
  warmup: WarmupProgressResponse | null;
  jobs: WarmupJob[];
  loading: boolean;
  jobsLoading: boolean;
  error: string | null;
  jobsError: string | null;
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
  onAddDates: (dates: string[]) => void;
  onRemoveDate: (date: string) => void;
  onSubmit: () => void;
  onRefresh: () => void;
  onRefreshJobs: () => void;
}

export default function DataControlPanel({
  warmup, jobs, loading, jobsLoading, error, jobsError, operation, tableName, rowsPerDay, dateInput, dates, busy, message,
  onOperationChange, onTableChange, onRowsChange, onDateInputChange, onAddDates, onRemoveDate, onSubmit, onRefresh, onRefreshJobs,
}: DataControlPanelProps) {
  const t = useTranslations('Operations');
  const commonT = useTranslations('Common');
  const accessibilityT = useTranslations('Accessibility');
  const locale = useLocale();
  const statusLabel = (value: string | null | undefined) => {
    const labels: Record<string, string> = {
      RUNNING: t('statusRunning'),
      PENDING: t('statusPending'),
      COMPLETED: t('statusCompleted'),
      FAILED: t('statusFailed'),
      APPENDING: t('statusAppending'),
      ERROR: t('statusError'),
    };
    return value ? labels[value] || value : t('statusPending');
  };

  return <div className="space-y-4" id="operations-data-control" role="tabpanel">
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
      <Card className="!overflow-visible">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div><CardTitle className="text-sm font-medium">{t('dataOperation')}</CardTitle><p className="mt-1 text-xs text-muted-foreground">{t('queueDescription')}</p></div>
            <Database className="mt-0.5 size-4 text-primary" />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-2 rounded-md bg-muted/50 p-1">
            <ModeButton active={operation === 'INJECT'} onClick={() => onOperationChange('INJECT')}><Database />{t('injectRows')}</ModeButton>
            <ModeButton active={operation === 'CLEANUP'} onClick={() => onOperationChange('CLEANUP')}><Trash2 />{t('clearFullDays')}</ModeButton>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1"><span className="text-xs text-muted-foreground">{t('targetTable')}</span><TableSelect value={tableName} onChange={onTableChange} /></label>
            {operation === 'INJECT' && <label className="space-y-1"><span className="text-xs text-muted-foreground">{t('rowsPerSelectedDay')}</span><input type="number" min="1" max="1000000" value={rowsPerDay} onChange={(event) => onRowsChange(event.target.value)} className="h-8 w-full rounded-md border border-border bg-input px-2 text-sm outline-none focus:ring-1 focus:ring-ring" /></label>}
          </div>
          <div className="space-y-2">
            <div className="flex items-end justify-between gap-3">
              <span className="text-xs font-medium text-foreground">{t('selectedDates')}</span>
              <span className="text-[11px] tabular-nums text-muted-foreground">{dates.length ? dates.length === 1 ? t('dayQueued') : t('daysQueued', { count: dates.length }) : t('noDaysQueued')}</span>
            </div>
            <DatePicker value={dateInput} selectedDates={dates} onChange={onDateInputChange} onAddDates={onAddDates} className="w-full" />
            <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-lg border border-border/80 bg-background/30 p-2.5">
              {dates.length === 0 && <span className="px-1 text-xs text-muted-foreground">{t('chooseDate')}</span>}
              {dates.map((date) => <span key={date} className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 font-mono text-xs ring-1 ring-inset ring-primary/20">{date}<button type="button" aria-label={accessibilityT('removeDate', { date })} title={accessibilityT('removeDate', { date })} onClick={() => onRemoveDate(date)} className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-primary/15 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="size-3" /></button></span>)}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            <p className="max-w-md text-xs text-muted-foreground">{operation === 'INJECT' ? t('maximumRows') : t('clearPartition')}</p>
            <Button onClick={onSubmit} disabled={busy || dates.length === 0}>{busy ? <><RefreshCw className="animate-spin" />{t('queuing')}</> : operation === 'INJECT' ? <><Database />{t('queueInjection')}</> : <><Trash2 />{t('queueCleanup')}</>}</Button>
          </div>
          {message && <p className="text-xs text-muted-foreground">{message}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="!flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-sm font-medium">{t('warmupWindow')}</CardTitle>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('refreshWarmupStatus')}
            title={t('refreshWarmupStatus')}
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw className={loading ? 'animate-spin' : ''} />
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-2"><RunnerMetric title={t('window')} value={warmup ? commonT('days', { count: warmup.windowDays }) : '—'} /><RunnerMetric title={t('defaultPerDay')} value={warmup ? formatNumber(warmup.rowsPerDay, locale) : '—'} /><RunnerMetric title={t('target')} value={warmup ? formatNumber(warmup.targetRows, locale) : '—'} /></div>
          <div className="space-y-2">
            {warmup?.tables.map((table) => <div key={table.tableName} className="border-t border-border pt-2"><div className="flex items-center justify-between gap-2 text-xs"><span className="flex min-w-0 items-center gap-2 font-mono"><span className={`status-dot ${table.status === 'ERROR' ? 'status-dot-red' : table.status === 'APPENDING' ? 'status-dot-green' : 'status-dot-yellow'}`} />{table.tableName}</span><Badge variant="outline">{statusLabel(table.status)}</Badge></div><div className="mt-1 grid grid-cols-3 gap-2 text-xs text-muted-foreground"><span>{t('actualRows', { count: formatNumber(table.actualRows, locale) })}</span><span>{formatNumber(table.dayCompletedRows, locale)}/{formatNumber(table.dayTargetRows, locale)} {t('today')}</span><span className="text-right">{table.guardReason ?? formatBytes(table.tableBytes, locale, t('sizePending'))}</span></div></div>)}
            {!warmup && loading && <p className="text-sm text-muted-foreground">{t('warmupStatusLoading')}</p>}
            {!warmup && !loading && <p className="text-sm text-destructive">{error ?? t('warmupStatusUnavailable')}</p>}
            {warmup && error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        </CardContent>
      </Card>
    </div>
    <Card>
      <CardHeader className="!flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm font-medium">{t('manualOperationQueue')}</CardTitle>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t('recent', { count: jobs.length })}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('refreshManualQueue')}
            title={t('refreshManualQueue')}
            onClick={onRefreshJobs}
            disabled={jobsLoading}
          >
            <RefreshCw className={jobsLoading ? 'animate-spin' : ''} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!jobs.length && jobsLoading && <p className="text-sm text-muted-foreground">{t('loadingManualOperations')}</p>}
        {!jobs.length && !jobsLoading && <p className="text-sm text-muted-foreground">{jobsError ?? t('noManualOperations')}</p>}
        {jobs.length > 0 && jobsError && <p className="mb-2 text-xs text-destructive">{jobsError}</p>}
        <div className="space-y-1">{jobs.map((job) => <div key={job.id} className="grid gap-1 border-b border-border py-2 last:border-0 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:gap-3"><span className="font-mono text-xs text-muted-foreground">#{job.id}</span><div className="min-w-0 text-xs"><span className="font-medium">{job.operation === 'INJECT' ? t('inject') : t('clear')} {job.tableName}</span><span className="ml-2 text-muted-foreground">{job.dates.join(', ')}</span>{job.operation === 'INJECT' && <span className="ml-2 text-muted-foreground">{t('perDay', { count: formatNumber(job.rowsPerDay, locale) })}</span>}{job.errorMessage && <p className="truncate text-destructive">{job.errorMessage}</p>}</div><div className="flex items-center gap-2 text-xs"><span className="text-muted-foreground">{job.operation === 'INJECT' ? t('processedRows', { count: formatNumber(job.processedRows, locale) }) : t('processedDays', { completed: formatNumber(job.processedDays, locale), total: formatNumber(job.dates.length, locale) })}</span><Badge variant={job.status === 'FAILED' ? 'destructive' : job.status === 'COMPLETED' ? 'default' : 'outline'}>{statusLabel(job.status)}</Badge></div></div>)}</div>
      </CardContent>
    </Card>
  </div>;
}
