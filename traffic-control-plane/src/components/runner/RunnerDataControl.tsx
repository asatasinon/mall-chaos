'use client';

import { Database, RefreshCw, Trash2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import DatePicker from '@/components/runner/DatePicker';
import { ModeButton, RunnerMetric, TableSelect } from '@/components/runner/RunnerControls';
import type { WarmupResponse } from '@/components/runner/types';
import { formatBytes, formatNumber } from '@/components/runner/utils';

interface DataControlPanelProps {
  warmup: WarmupResponse | null;
  loading: boolean;
  error: string | null;
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
}

export default function DataControlPanel({
  warmup, loading, error, operation, tableName, rowsPerDay, dateInput, dates, busy, message,
  onOperationChange, onTableChange, onRowsChange, onDateInputChange, onAddDates, onRemoveDate, onSubmit, onRefresh,
}: DataControlPanelProps) {
  return <div className="space-y-4" id="runner-data-control" role="tabpanel">
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
      <Card className="!overflow-visible">
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
            <div className="flex items-end justify-between gap-3">
              <span className="text-xs font-medium text-foreground">Selected dates</span>
              <span className="text-[11px] tabular-nums text-muted-foreground">{dates.length ? `${dates.length} ${dates.length === 1 ? 'day' : 'days'} queued` : 'No days queued'}</span>
            </div>
            <DatePicker value={dateInput} selectedDates={dates} onChange={onDateInputChange} onAddDates={onAddDates} className="w-full" />
            <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-lg border border-border/80 bg-background/30 p-2.5">
              {dates.length === 0 && <span className="px-1 text-xs text-muted-foreground">Choose a date above, then add it to the queue.</span>}
              {dates.map((date) => <span key={date} className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 font-mono text-xs ring-1 ring-inset ring-primary/20">{date}<button type="button" aria-label={`Remove ${date}`} title={`Remove ${date}`} onClick={() => onRemoveDate(date)} className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-primary/15 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="size-3" /></button></span>)}
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
        <CardHeader className="!flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-sm font-medium">Warmup window</CardTitle>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Refresh warmup status"
            title="Refresh warmup status"
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw className={loading ? 'animate-spin' : ''} />
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-2"><RunnerMetric title="Window" value={warmup ? `${warmup.windowDays} days` : '—'} /><RunnerMetric title="Default/day" value={warmup ? formatNumber(warmup.rowsPerDay) : '—'} /><RunnerMetric title="Target" value={warmup ? formatNumber(warmup.targetRows) : '—'} /></div>
          <div className="space-y-2">
            {warmup?.tables.map((table) => <div key={table.tableName} className="border-t border-border pt-2"><div className="flex items-center justify-between gap-2 text-xs"><span className="flex min-w-0 items-center gap-2 font-mono"><span className={`status-dot ${table.status === 'PAUSED_GUARD' || table.status === 'ERROR' ? 'status-dot-red' : table.status === 'APPENDING' ? 'status-dot-green' : 'status-dot-yellow'}`} />{table.tableName}</span><Badge variant={table.status === 'PAUSED_GUARD' ? 'destructive' : 'outline'}>{table.status}</Badge></div><div className="mt-1 grid grid-cols-3 gap-2 text-xs text-muted-foreground"><span>{formatNumber(table.actualRows)} rows</span><span>{formatNumber(table.dayCompletedRows)}/{formatNumber(table.dayTargetRows)} today</span><span className="text-right">{table.guardReason ?? formatBytes(table.tableBytes)}</span></div></div>)}
            {!warmup && loading && <p className="text-sm text-muted-foreground">Loading warmup status...</p>}
            {!warmup && !loading && <p className="text-sm text-destructive">{error ?? 'Warmup status is unavailable'}</p>}
            {warmup && error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        </CardContent>
      </Card>
    </div>
    <Card>
      <CardHeader className="!flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm font-medium">Manual operation queue</CardTitle>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{warmup?.jobs.length ?? 0} recent</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Refresh manual operation queue"
            title="Refresh manual operation queue"
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw className={loading ? 'animate-spin' : ''} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!warmup?.jobs.length && <p className="text-sm text-muted-foreground">No manual operations yet.</p>}
        <div className="space-y-1">{warmup?.jobs.map((job) => <div key={job.id} className="grid gap-1 border-b border-border py-2 last:border-0 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:gap-3"><span className="font-mono text-xs text-muted-foreground">#{job.id}</span><div className="min-w-0 text-xs"><span className="font-medium">{job.operation === 'INJECT' ? 'Inject' : 'Clear'} {job.tableName}</span><span className="ml-2 text-muted-foreground">{job.dates.join(', ')}</span>{job.operation === 'INJECT' && <span className="ml-2 text-muted-foreground">{formatNumber(job.rowsPerDay)}/day</span>}{job.errorMessage && <p className="truncate text-destructive">{job.errorMessage}</p>}</div><div className="flex items-center gap-2 text-xs"><span className="text-muted-foreground">{job.operation === 'INJECT' ? `${formatNumber(job.processedRows)} rows` : `${job.processedDays}/${job.dates.length} days`}</span><Badge variant={job.status === 'FAILED' || job.status === 'PAUSED_GUARD' ? 'destructive' : job.status === 'COMPLETED' ? 'default' : 'outline'}>{job.status}</Badge></div></div>)}</div>
      </CardContent>
    </Card>
  </div>;
}
