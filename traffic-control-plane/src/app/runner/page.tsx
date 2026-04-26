'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Play, Pause, Pencil, Save, X, Check } from 'lucide-react';

interface RunnerStatus {
  running: boolean; paused: boolean;
  currentQps: number; successRate: number; failRate: number;
  totalRequests: number; rateMultiplier: number;
}
interface MixRule { actionType: string; ratio: number; }
interface RunnerConfig {
  version: number; baseQps: number; peakMultiplier: number;
  cycleMinutes: number; jitterPct: number; mixRules: MixRule[];
}
interface ConfigForm { baseQps: string; peakMultiplier: string; cycleMinutes: string; jitterPct: string; }
interface ActivityEntry { ts: number; action: string; success: boolean; latencyMs: number; }

const ACTION_LABELS: Record<string, string> = {
  ORDER_SUCCESS: 'Order',
  ORDER_FAIL:    'Fail',
  CANCEL:        'Cancel',
};

export default function RunnerPage() {
  const [status, setStatus]       = useState<RunnerStatus | null>(null);
  const [config, setConfig]       = useState<RunnerConfig | null>(null);
  const [multiplier, setMult]     = useState('1.0');
  const [editing, setEditing]     = useState(false);
  const [form, setForm]           = useState<ConfigForm>({ baseQps: '', peakMultiplier: '', cycleMinutes: '', jitterPct: '' });
  const [saving, setSaving]       = useState(false);
  const [saveMsg, setSaveMsg]     = useState<{ ok: boolean; text: string } | null>(null);

  const [mixEditing, setMixEditing] = useState(false);
  const [mixForm, setMixForm]       = useState<MixRule[]>([]);
  const [mixSaving, setMixSaving]   = useState(false);
  const [mixMsg, setMixMsg]         = useState<{ ok: boolean; text: string } | null>(null);

  const [activity, setActivity]   = useState<ActivityEntry[]>([]);

  const loadConfig = async () => {
    const res  = await fetch('/internal/traffic/runner/config');
    const json = await res.json();
    if (json.code === 0) {
      setConfig(json.data);
      setForm({
        baseQps:        String(json.data.baseQps),
        peakMultiplier: String(json.data.peakMultiplier),
        cycleMinutes:   String(json.data.cycleMinutes),
        jitterPct:      String((json.data.jitterPct * 100).toFixed(0)),
      });
      setMixForm(json.data.mixRules ?? []);
    }
  };

  useEffect(() => {
    const loadStatus = async () => {
      try {
        const res  = await fetch('/internal/traffic/runner/status');
        const json = await res.json();
        if (json.code === 0) setStatus(json.data);
      } catch {}
    };
    const loadActivity = async () => {
      try {
        const res  = await fetch('/internal/traffic/runner/activity?limit=20');
        const json = await res.json();
        if (json.code === 0) setActivity(json.data);
      } catch {}
    };
    loadConfig().catch(() => {});
    loadStatus();
    loadActivity();
    const id1 = setInterval(loadStatus, 3000);
    const id2 = setInterval(loadActivity, 5000);
    return () => { clearInterval(id1); clearInterval(id2); };
  }, []);

  const action = (path: string, body?: unknown) =>
    fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

  const saveConfig = async () => {
    if (!config) return;
    setSaving(true); setSaveMsg(null);
    try {
      const res  = await fetch('/internal/traffic/runner/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version:        config.version,
          baseQps:        parseFloat(form.baseQps),
          peakMultiplier: parseFloat(form.peakMultiplier),
          cycleMinutes:   parseInt(form.cycleMinutes, 10),
          jitterPct:      parseFloat(form.jitterPct) / 100,
        }),
      });
      const json = await res.json();
      if (json.code === 0) {
        setSaveMsg({ ok: true, text: `Saved · v${json.data.newVersion}` });
        setEditing(false);
        await loadConfig();
      } else {
        setSaveMsg({ ok: false, text: json.message || 'Save failed' });
      }
    } catch (e: unknown) {
      setSaveMsg({ ok: false, text: e instanceof Error ? e.message : 'error' });
    } finally { setSaving(false); }
  };

  const cancelEdit = () => {
    setEditing(false); setSaveMsg(null);
    if (config) setForm({
      baseQps:        String(config.baseQps),
      peakMultiplier: String(config.peakMultiplier),
      cycleMinutes:   String(config.cycleMinutes),
      jitterPct:      String((config.jitterPct * 100).toFixed(0)),
    });
  };

  const saveMix = async () => {
    if (!config) return;
    const total = mixForm.reduce((s, r) => s + r.ratio, 0);
    if (total <= 0) { setMixMsg({ ok: false, text: 'Ratios must sum > 0' }); return; }
    const normalised = mixForm.map((r) => ({ ...r, ratio: +(r.ratio / total).toFixed(4) }));
    setMixSaving(true); setMixMsg(null);
    try {
      const res  = await fetch('/internal/traffic/runner/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: config.version, mixRules: normalised }),
      });
      const json = await res.json();
      if (json.code === 0) {
        setMixMsg({ ok: true, text: `Saved · v${json.data.newVersion}` });
        setMixEditing(false);
        await loadConfig();
      } else {
        setMixMsg({ ok: false, text: json.message || 'Save failed' });
      }
    } catch (e: unknown) {
      setMixMsg({ ok: false, text: e instanceof Error ? e.message : 'error' });
    } finally { setMixSaving(false); }
  };

  const cancelMix = () => {
    setMixEditing(false); setMixMsg(null);
    setMixForm(config?.mixRules ?? []);
  };

  const successPct = status ? status.successRate * 100 : 0;
  const failPct    = status ? status.failRate    * 100 : 0;
  const dotCls     = !status ? 'status-dot-off' : status.paused ? 'status-dot-yellow' : status.running ? 'status-dot-green' : 'status-dot-off';
  const stateLabel = !status ? '—' : status.paused ? 'Paused' : status.running ? 'Running' : 'Stopped';

  const KPI_ITEMS = [
    { label: 'QPS',        value: status ? String(status.currentQps) : '—',             color: 'green' },
    { label: 'Success',    value: status ? `${successPct.toFixed(1)}%` : '—',           color: 'green' },
    { label: 'Fail',       value: status ? `${failPct.toFixed(1)}%` : '—',              color: failPct > 5 ? 'red' : 'muted' },
    { label: 'Total req',  value: status ? status.totalRequests.toLocaleString() : '—', color: 'muted' },
    { label: 'Multiplier', value: status ? `${status.rateMultiplier}×` : '—',           color: 'muted' },
  ] as const;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Runner</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Traffic generation · rate management</p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-5 gap-3">
        {KPI_ITEMS.map((k) => (
          <Card key={k.label}>
            <CardContent className="pt-4 pb-3 px-4">
              <p className="text-[11px] text-muted-foreground mb-1.5">{k.label}</p>
              <p className={`text-2xl font-semibold tabular-nums ${
                k.color === 'green' ? 'text-[oklch(0.55_0.15_155)]' :
                k.color === 'red'   ? 'text-destructive' :
                'text-muted-foreground'
              }`}>{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Baseline Config card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center justify-between">
            <span className="flex items-center gap-2">
              Baseline Config
              {config && <Badge variant="secondary" className="text-[10px] font-mono">v{config.version}</Badge>}
            </span>
            <div className="flex items-center gap-3">
              <span className={`status-dot ${dotCls}`} />
              <span className="text-xs font-normal text-muted-foreground">{stateLabel}</span>
              {!editing ? (
                <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => setEditing(true)}>
                  <Pencil />Edit
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  {saveMsg && <span className={`text-xs ${saveMsg.ok ? 'text-[oklch(0.55_0.15_155)]' : 'text-destructive'}`}>{saveMsg.text}</span>}
                  <Button size="sm" variant="outline" className="text-xs h-7" onClick={saveConfig} disabled={saving}>
                    <Save />{saving ? 'Saving…' : 'Save'}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-xs h-7" onClick={cancelEdit}>
                    <X />Cancel
                  </Button>
                </div>
              )}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Lifecycle + rate row */}
          <div className="flex items-center gap-4">
            {status?.running && !status.paused ? (
              <Button size="sm" variant="outline" className="border-warning/40 text-warning hover:bg-warning/10"
                onClick={() => action('/internal/traffic/runner/pause')}>
                <Pause />Pause
              </Button>
            ) : (
              <Button size="sm" className="bg-[oklch(0.55_0.15_155)] hover:bg-[oklch(0.50_0.15_155)] text-white"
                onClick={() => action('/internal/traffic/runner/resume')}>
                <Play />Resume
              </Button>
            )}
            <div className="h-5 w-px bg-border" />
            <span className="text-xs text-muted-foreground shrink-0">Rate multiplier</span>
            <div className="flex items-center gap-2">
              <input
                type="number" step="0.1" min="0.1" max="10" value={multiplier}
                onChange={(e) => setMult(e.target.value)}
                className="w-20 h-8 rounded-md border border-border bg-input px-2.5 text-sm font-mono text-foreground outline-none focus:ring-1 focus:ring-ring"
              />
              <Button size="sm" variant="outline" className="h-8"
                onClick={() => action('/internal/traffic/runner/rate', { multiplier: parseFloat(multiplier) })}>
                <Check />Apply
              </Button>
            </div>
          </div>
          <div className="h-px bg-border" />
          {!config && <p className="text-sm text-muted-foreground">Loading…</p>}
          {config && !editing && (
            <div className="grid grid-cols-4 gap-3">
              <KVTile label="Base QPS"   value={String(config.baseQps)} />
              <KVTile label="Peak mult." value={`${config.peakMultiplier}×`} />
              <KVTile label="Cycle"      value={`${config.cycleMinutes} min`} />
              <KVTile label="Jitter"     value={`${(config.jitterPct * 100).toFixed(0)}%`} />
            </div>
          )}
          {config && editing && (
            <div className="grid grid-cols-4 gap-3">
              <Field label="Base QPS"    hint="req/s baseline" value={form.baseQps}        type="number" min="1"   step="1"
                onChange={(v) => setForm((f) => ({ ...f, baseQps: v }))} />
              <Field label="Peak mult."  hint="spike factor"   value={form.peakMultiplier} type="number" min="1"   step="0.1"
                onChange={(v) => setForm((f) => ({ ...f, peakMultiplier: v }))} />
              <Field label="Cycle (min)" hint="wave period"    value={form.cycleMinutes}   type="number" min="1"   step="1"
                onChange={(v) => setForm((f) => ({ ...f, cycleMinutes: v }))} />
              <Field label="Jitter %"    hint="0–100"          value={form.jitterPct}      type="number" min="0"   max="100" step="1"
                onChange={(v) => setForm((f) => ({ ...f, jitterPct: v }))} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Traffic Mix card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center justify-between">
            Traffic Mix
            {!mixEditing ? (
              <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => { setMixEditing(true); setMixMsg(null); }}>
                <Pencil />Edit
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                {mixMsg && <span className={`text-xs ${mixMsg.ok ? 'text-[oklch(0.55_0.15_155)]' : 'text-destructive'}`}>{mixMsg.text}</span>}
                <Button size="sm" variant="outline" className="text-xs h-7" onClick={saveMix} disabled={mixSaving}>
                  <Save />{mixSaving ? 'Saving…' : 'Save'}
                </Button>
                <Button size="sm" variant="ghost" className="text-xs h-7" onClick={cancelMix}>
                  <X />Cancel
                </Button>
              </div>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!config && <p className="text-sm text-muted-foreground">Loading…</p>}
          {config && (
            <div className="space-y-2.5">
              {(mixEditing ? mixForm : config.mixRules).map((rule, i) => {
                const displayPct = (rule.ratio * 100).toFixed(1);
                const actionLabel = ACTION_LABELS[rule.actionType] ?? rule.actionType;
                const barColor = rule.actionType === 'ORDER_SUCCESS'
                  ? 'bg-[oklch(0.55_0.15_155)]'
                  : rule.actionType === 'ORDER_FAIL'
                  ? 'bg-destructive'
                  : 'bg-muted-foreground/40';

                return (
                  <div key={rule.actionType} className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-20 shrink-0 font-mono">{actionLabel}</span>
                    <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-300 ${barColor}`}
                        style={{ width: `${Math.min(rule.ratio * 100, 100)}%` }} />
                    </div>
                    {!mixEditing ? (
                      <span className="text-xs font-mono tabular-nums w-12 text-right">{displayPct}%</span>
                    ) : (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <input
                          type="number" min="0" max="100" step="1"
                          value={(mixForm[i].ratio * 100).toFixed(0)}
                          onChange={(e) => {
                            const v = Math.max(0, parseFloat(e.target.value) || 0) / 100;
                            setMixForm((prev) => prev.map((r, j) => j === i ? { ...r, ratio: v } : r));
                          }}
                          className="w-16 h-7 rounded-md border border-border bg-input px-2 text-xs font-mono text-foreground outline-none focus:ring-1 focus:ring-ring"
                        />
                        <span className="text-xs text-muted-foreground">%</span>
                      </div>
                    )}
                  </div>
                );
              })}
              {mixEditing && (
                <p className="text-[11px] text-muted-foreground pt-1">
                  Values are normalised to 100% on save. Current sum: {(mixForm.reduce((s, r) => s + r.ratio, 0) * 100).toFixed(0)}%
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Activity card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center justify-between">
            Recent Activity
            <span className="text-[11px] text-muted-foreground font-normal">auto-refresh every 5s</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activity.length === 0 && (
            <p className="text-sm text-muted-foreground">No activity yet — start the runner to see requests.</p>
          )}
          {activity.length > 0 && (
            <div className="space-y-1">
              {activity.map((e, i) => {
                const time = new Date(e.ts).toISOString().slice(11, 19);
                const label = ACTION_LABELS[e.action] ?? e.action;
                return (
                  <div key={i} className="flex items-center gap-3 text-xs">
                    <span className="font-mono text-muted-foreground tabular-nums w-20 shrink-0">{time}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      e.action === 'ORDER_SUCCESS' ? 'bg-[oklch(0.55_0.15_155)]/10 text-[oklch(0.55_0.15_155)]' :
                      e.action === 'ORDER_FAIL'    ? 'bg-destructive/10 text-destructive' :
                      'bg-muted text-muted-foreground'
                    }`}>{label}</span>
                    <span className={e.success ? 'text-[oklch(0.55_0.15_155)]' : 'text-destructive'}>
                      {e.success ? '✓' : '✗'}
                    </span>
                    <span className="text-muted-foreground tabular-nums">{e.latencyMs}ms</span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KVTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/40 px-3 py-2.5">
      <p className="text-[11px] text-muted-foreground mb-1">{label}</p>
      <p className="text-xl font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function Field({ label, hint, value, onChange, type, min, max, step }: {
  label: string; hint: string; value: string; onChange: (v: string) => void;
  type?: string; min?: string; max?: string; step?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <input type={type} min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border bg-input px-2.5 py-1.5 text-sm font-mono text-foreground outline-none focus:ring-1 focus:ring-ring" />
      <p className="text-[11px] text-muted-foreground/60">{hint}</p>
    </div>
  );
}
