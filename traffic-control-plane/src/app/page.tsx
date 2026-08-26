'use client';

import { useEffect, useState } from 'react';
import { Activity, Clock3, ExternalLink, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchWithAuth } from '@/lib/auth-fetch';

interface FaultRun {
  faultRunId: string;
  scenario: string;
  targetService: string;
  targetOperation: string;
  state: string;
  expiresAt: string;
  createdAt: string;
}

interface FaultRunResponse {
  scenarios: Array<{ scenario: string; targetService: string; targetOperation: string }>;
  runs: FaultRun[];
}

export default function OverviewPage() {
  const [data, setData] = useState<FaultRunResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetchWithAuth('/internal/fault-runs');
        const result = await response.json() as { code: number; message: string; data: FaultRunResponse };
        if (!response.ok || result.code !== 0) throw new Error(result.message);
        if (active) {
          setData(result.data);
          setError(null);
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Unable to load Fault Runs');
      }
    };
    void load();
    const timer = setInterval(() => { void load(); }, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const activeRun = data?.runs.find((run) => ['CREATING', 'ACTIVE', 'RECOVERING'].includes(run.state));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Fault Runs</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Protected scenario coordination and recovery evidence</p>
      </div>

      {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">{error}</div>}

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard icon={<ShieldCheck className="size-4" />} label="Scenario catalog" value={data ? String(data.scenarios.length) : '...'} />
        <MetricCard icon={<Activity className="size-4" />} label="Active run" value={activeRun ? activeRun.state : 'None'} />
        <MetricCard icon={<Clock3 className="size-4" />} label="Recorded runs" value={data ? String(data.runs.length) : '...'} />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm font-medium">Recent runs</CardTitle>
          <a
            href="/internal/fault-runs"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-2 rounded-md border border-input bg-background px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            Open API <ExternalLink className="size-3.5" />
          </a>
        </CardHeader>
        <CardContent>
          {!data && !error && <p className="text-sm text-muted-foreground">Loading...</p>}
          {data?.runs.length === 0 && <p className="text-sm text-muted-foreground">No Fault Runs recorded in the last seven days.</p>}
          {data && data.runs.length > 0 && (
            <div className="divide-y divide-border">
              {data.runs.map((run) => (
                <a key={run.faultRunId} href={`/internal/fault-runs/${run.faultRunId}`} target="_blank" rel="noreferrer" className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0 hover:bg-muted/30">
                  <div>
                    <p className="text-sm font-medium">{run.scenario}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{run.targetService} / {run.targetOperation}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={run.state === 'ACTIVE' ? 'destructive' : 'secondary'}>{run.state}</Badge>
                    <span className="font-mono text-xs text-muted-foreground">{run.faultRunId.slice(0, 8)}</span>
                  </div>
                </a>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 pt-5">
        <span className="text-primary">{icon}</span>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 text-lg font-semibold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
