'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface OverviewData {
  runner: {
    running: boolean; paused: boolean;
    currentQps: number; successRate: number; failRate: number; totalRequests: number;
  };
  chaos: Record<string, unknown>;
  timestamp: string;
}

export default function OverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/internal/traffic/chaos/overview');
        const json = await res.json();
        if (json.code === 0) { setData(json.data); setError(null); }
        else setError(json.message);
      } catch (e: unknown) { setError(e instanceof Error ? e.message : 'network error'); }
    };
    load();
    const id = setInterval(() => { load(); setTick((t) => t + 1); }, 5000);
    return () => clearInterval(id);
  }, []);

  const successPct = data ? data.runner.successRate * 100 : 0;
  const failPct    = data ? data.runner.failRate    * 100 : 0;
  const runnerLabel = !data ? 'Unknown'
    : data.runner.paused ? 'Paused'
    : data.runner.running ? 'Running' : 'Stopped';
  const dotCls = !data ? 'status-dot-off'
    : data.runner.paused ? 'status-dot-yellow'
    : data.runner.running ? 'status-dot-green' : 'status-dot-off';

  const anyArmed = data
    ? Object.values(data.chaos).some((v) => {
        const o = v as Record<string, unknown>;
        return o.enabled === true || o.active === true;
      })
    : false;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Live telemetry · auto-refresh every 5s {tick > 0 && `· #${tick}`}</p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-3 gap-4">
        <MetricCard title="Throughput" unit="req/s">
          <span className="metric-value text-primary">{data?.runner.currentQps ?? '—'}</span>
        </MetricCard>
        <MetricCard title="Success Rate">
          <span className={`metric-value ${successPct < 90 ? 'text-destructive' : 'text-[oklch(0.62_0.18_155)]'}`}>
            {data ? `${successPct.toFixed(1)}%` : '—'}
          </span>
          <ProgressBar value={successPct} variant={successPct < 90 ? 'danger' : 'success'} />
        </MetricCard>
        <MetricCard title="Error Rate">
          <span className={`metric-value ${failPct > 5 ? 'text-destructive' : 'text-muted-foreground'}`}>
            {data ? `${failPct.toFixed(1)}%` : '—'}
          </span>
          <ProgressBar value={Math.min(failPct * 4, 100)} variant="danger" />
        </MetricCard>
      </div>

      {/* Runner + chaos map */}
      <div className="grid grid-cols-[260px_1fr] gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center justify-between">
              Runner
              <div className="flex items-center gap-2">
                <span className={`status-dot ${dotCls}`} />
                <span className="text-xs font-normal text-muted-foreground">{runnerLabel}</span>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            <StatRow label="Status"    value={runnerLabel}
              valueClass={data?.runner.running && !data.runner.paused ? 'text-[oklch(0.62_0.18_155)]' : 'text-muted-foreground'} />
            <StatRow label="QPS"       value={data ? String(data.runner.currentQps) : '—'} />
            <StatRow label="Success"   value={data ? `${successPct.toFixed(2)}%` : '—'} valueClass="text-[oklch(0.62_0.18_155)]" />
            <StatRow label="Fail"      value={data ? `${failPct.toFixed(2)}%` : '—'}
              valueClass={failPct > 5 ? 'text-destructive' : ''} />
            <StatRow label="Total req" value={data ? data.runner.totalRequests.toLocaleString() : '—'} />
            <StatRow label="Last sync" value={data ? new Date(data.timestamp).toISOString().slice(11, 19) + 'Z' : '—'} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center justify-between">
              Chaos Subsystems
              {anyArmed && (
                <Badge variant="destructive" className="text-[10px] gap-1.5">
                  <span className="status-dot status-dot-red" style={{ width: 6, height: 6 }} />
                  Armed
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!data && <p className="text-sm text-muted-foreground">Loading…</p>}
            {data && (
              <div className="grid grid-cols-3 gap-2.5">
                {Object.entries(data.chaos).map(([key, value]) => {
                  const obj = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
                  const isError   = !!obj.error;
                  const isEnabled = obj.enabled === true || obj.active === true;
                  return (
                    <div key={key} className={[
                      'rounded-md border px-3 py-2.5 flex items-center justify-between',
                      isEnabled ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-muted/20',
                    ].join(' ')}>
                      <div>
                        <p className="text-[11px] font-medium text-foreground/80 capitalize">
                          {key.replace(/([A-Z])/g, ' $1').trim()}
                        </p>
                        <p className={`text-[11px] mt-0.5 ${isEnabled ? 'text-destructive' : 'text-muted-foreground'}`}>
                          {isError ? 'N/A' : isEnabled ? 'Injecting' : 'Standby'}
                        </p>
                      </div>
                      <span className={`status-dot ${isEnabled ? 'status-dot-red' : 'status-dot-off'}`} />
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({ title, unit, children }: { title: string; unit?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
          {title}
          {unit && <span className="text-xs font-normal">{unit}</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">{children}</CardContent>
    </Card>
  );
}

function ProgressBar({ value, variant }: { value: number; variant: 'success' | 'danger' }) {
  const fill = variant === 'success'
    ? 'bg-[oklch(0.62_0.18_155)]'
    : 'bg-destructive';
  return (
    <div className="h-1 rounded-full bg-muted overflow-hidden">
      <div className={`h-full rounded-full transition-all duration-500 ${fill}`} style={{ width: `${Math.min(value, 100)}%` }} />
    </div>
  );
}

function StatRow({ label, value, valueClass = '' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono font-medium tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
}
