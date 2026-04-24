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
interface RunnerConfig {
  version: number; baseQps: number; peakMultiplier: number;
  cycleMinutes: number; jitterPct: number;
}
interface ConfigForm { baseQps: string; peakMultiplier: string; cycleMinutes: string; jitterPct: string; }

export default function RunnerPage() {
  const [status, setStatus]   = useState<RunnerStatus | null>(null);
  const [config, setConfig]   = useState<RunnerConfig | null>(null);
  const [multiplier, setMult] = useState('1.0');
  const [editing, setEditing] = useState(false);
  const [form, setForm]       = useState<ConfigForm>({ baseQps: '', peakMultiplier: '', cycleMinutes: '', jitterPct: '' });
  const [saving, setSaving]   = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

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
    loadConfig().catch(() => {});
    loadStatus();
    const id = setInterval(loadStatus, 3000);
    return () => clearInterval(id);
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

  const successPct   = status ? status.successRate * 100 : 0;
  const failPct      = status ? status.failRate    * 100 : 0;
  const dotCls       = !status ? 'status-dot-off' : status.paused ? 'status-dot-yellow' : status.running ? 'status-dot-green' : 'status-dot-off';
  const stateLabel   = !status ? '—' : status.paused ? 'Paused' : status.running ? 'Running' : 'Stopped';

  const KPI_ITEMS = [
    { label: 'QPS',        value: status ? String(status.currentQps) : '—',              color: 'green' },
    { label: 'Success',    value: status ? `${successPct.toFixed(1)}%` : '—',            color: 'green' },
    { label: 'Fail',       value: status ? `${failPct.toFixed(1)}%` : '—',               color: failPct > 5 ? 'red' : 'muted' },
    { label: 'Total req',  value: status ? status.totalRequests.toLocaleString() : '—',  color: 'muted' },
    { label: 'Multiplier', value: status ? `${status.rateMultiplier}×` : '—',            color: 'muted' },
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

      {/* Config card (merged with controls) */}
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
          {/* Config values */}
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
