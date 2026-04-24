'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface ScenarioStep  { type: string; action: string; path: string; body: unknown; }
interface ScenarioInfo  { id: string; name: string; description: string; stepCount: number; steps?: ScenarioStep[]; }
interface StepResult    { step?: number; path?: string; success: boolean; error?: string; }
interface ExecRecord    { op: 'execute' | 'recover'; ts: string; results: StepResult[]; }

export default function ScenariosPage() {
  const [scenarios, setScenarios]   = useState<ScenarioInfo[]>([]);
  const [executing, setExecuting]   = useState<string | null>(null);
  const [expanded, setExpanded]     = useState<Record<string, boolean>>({});
  const [history, setHistory]       = useState<Record<string, ExecRecord[]>>({});
  const [recoveringAll, setRecAll]  = useState(false);
  const [recoverMsg, setRecoverMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch('/internal/traffic/scenarios')
      .then((r) => r.json())
      .then((json) => { if (json.code === 0) setScenarios(json.data); })
      .catch(() => {});
  }, []);

  const pushHistory = (id: string, rec: ExecRecord) =>
    setHistory((prev) => ({ ...prev, [id]: [rec, ...(prev[id] ?? [])].slice(0, 5) }));

  const run = async (id: string) => {
    setExecuting(id);
    try {
      const res  = await fetch(`/internal/traffic/scenarios/${id}/run`, { method: 'POST' });
      const json = await res.json();
      pushHistory(id, { op: 'execute', ts: new Date().toISOString().slice(11, 19) + 'Z', results: json.data?.results ?? [] });
    } catch (e: unknown) {
      pushHistory(id, { op: 'execute', ts: new Date().toISOString().slice(11, 19) + 'Z', results: [{ success: false, error: String(e) }] });
    } finally { setExecuting(null); }
  };

  const recover = async (id: string) => {
    setExecuting(`recover-${id}`);
    try {
      const res  = await fetch(`/internal/traffic/scenarios/${id}/recover`, { method: 'POST' });
      const json = await res.json();
      pushHistory(id, { op: 'recover', ts: new Date().toISOString().slice(11, 19) + 'Z', results: json.data?.results ?? [] });
    } catch (e: unknown) {
      pushHistory(id, { op: 'recover', ts: new Date().toISOString().slice(11, 19) + 'Z', results: [{ success: false, error: String(e) }] });
    } finally { setExecuting(null); }
  };

  const recoverAll = async () => {
    setRecAll(true);
    try {
      const res  = await fetch('/internal/traffic/scenarios/recover-all', { method: 'POST' });
      const json = await res.json();
      const ok   = (json.data?.results ?? []).filter((r: StepResult) => r.success).length;
      const fail = (json.data?.results ?? []).filter((r: StepResult) => !r.success).length;
      setRecoverMsg(`Recovered: ${ok} ok · ${fail} failed`);
    } catch (e: unknown) { setRecoverMsg(`Error: ${String(e)}`); }
    finally { setRecAll(false); }
  };

  const busy = executing !== null || recoveringAll;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Scenarios</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Preset fault scenarios — one-click injection</p>
        </div>
        <div className="flex items-center gap-3 pt-1">
          {recoverMsg && <span className="text-sm text-muted-foreground">{recoverMsg}</span>}
          <Button variant="outline"
            className="border-warning/40 text-warning hover:bg-warning/10"
            onClick={recoverAll} disabled={busy}>
            {recoveringAll ? 'Recovering…' : '↺ Recover All'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {scenarios.map((s) => {
          const recs      = history[s.id] ?? [];
          const isExec    = executing === s.id;
          const isRecover = executing === `recover-${s.id}`;
          const isOpen    = expanded[s.id];
          return (
            <Card key={s.id} className="flex flex-col">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-start justify-between gap-2">
                  <span>{s.name}</span>
                  <Badge variant="secondary" className="text-[10px] font-mono shrink-0">{s.id}</Badge>
                </CardTitle>
                <p className="text-xs text-muted-foreground leading-relaxed">{s.description}</p>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 flex-1">
                {/* Steps toggle */}
                <button
                  onClick={() => setExpanded((prev) => ({ ...prev, [s.id]: !prev[s.id] }))}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground w-fit transition-colors"
                >
                  <span className="text-[10px]">{isOpen ? '▲' : '▼'}</span>
                  {s.stepCount} step{s.stepCount !== 1 ? 's' : ''}
                </button>

                {/* Expanded steps */}
                {isOpen && s.steps && (
                  <div className="space-y-1.5">
                    {s.steps.map((step, i) => {
                      const actionColor = step.action === 'enable'
                        ? 'border-l-destructive text-destructive'
                        : step.action === 'disable'
                        ? 'border-l-muted-foreground text-muted-foreground'
                        : 'border-l-warning text-warning';
                      return (
                        <div key={i} className={`rounded-sm border border-border border-l-2 ${actionColor} bg-muted/20 px-2.5 py-2`}>
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-[10px] font-semibold uppercase tracking-wide">{step.action}</span>
                            <span className="text-[10px] text-muted-foreground">{step.type}</span>
                          </div>
                          <code className="text-[10px] text-muted-foreground/70 break-all">{step.path}</code>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex gap-2 mt-auto pt-1">
                  <Button size="sm" variant="destructive" onClick={() => run(s.id)} disabled={busy}>
                    {isExec ? 'Executing…' : 'Execute'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => recover(s.id)} disabled={busy}>
                    {isRecover ? 'Recovering…' : 'Recover'}
                  </Button>
                </div>

                {/* Execution history */}
                {recs.length > 0 && (
                  <div className="border-t border-border pt-3 space-y-1.5">
                    {recs.map((rec, i) => {
                      const allOk = rec.results.every((r) => r.success);
                      const nFail = rec.results.filter((r) => !r.success).length;
                      return (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <Badge variant={rec.op === 'execute' ? 'destructive' : 'secondary'} className="text-[10px]">
                            {rec.op}
                          </Badge>
                          <span className="font-mono text-muted-foreground">{rec.ts}</span>
                          <span className={allOk ? 'text-[oklch(0.62_0.18_155)]' : 'text-destructive'}>
                            {allOk ? `✓ ${rec.results.length} ok` : `✗ ${nFail} failed`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
