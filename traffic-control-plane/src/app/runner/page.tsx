'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

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
    const res = await fetch('/internal/traffic/runner/config');
    const json = await res.json();
    if (json.code === 0) {
      setConfig(json.data);
      setForm({
        baseQps:       String(json.data.baseQps),
        peakMultiplier:String(json.data.peakMultiplier),
        cycleMinutes:  String(json.data.cycleMinutes),
        jitterPct:     String((json.data.jitterPct * 100).toFixed(0)),
      });
    }
  };

  useEffect(() => {
    const loadStatus = async () => {
      try {
        const res = await fetch('/internal/traffic/runner/status');
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
      const res = await fetch('/internal/traffic/runner/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version:       config.version,
          baseQps:       parseFloat(form.baseQps),
          peakMultiplier:parseFloat(form.peakMultiplier),
          cycleMinutes:  parseInt(form.cycleMinutes, 10),
          jitterPct:     parseFloat(form.jitterPct) / 100,
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
      baseQps:       String(config.baseQps),
      peakMultiplier:String(config.peakMultiplier),
      cycleMinutes:  String(config.cycleMinutes),
      jitterPct:     String((config.jitterPct * 100).toFixed(0)),
    });
  };

  const dotCls   = !status ? 'status-dot-off' : status.paused ? 'status-dot-yellow' : status.running ? 'status-dot-green' : 'status-dot-off';
  const stateLabel = !status ? '—' : status.paused ? 'Paused' : status.running ? 'Running' : 'Stopped';
  const successPct = status ? status.successRate * 100 : 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Runner</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Traffic generation · rate management</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Status */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center justify-between">
              Traffic Status
              <div className="flex items-center gap-2">
                <span className={`status-dot ${dotCls}`} />
                <span className="text-xs font-normal text-muted-foreground">{stateLabel}</span>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {status ? (
              <>
                <StatRow label="QPS"        value={String(status.currentQps)} highlight />
                <StatRow label="Success"    value={`${successPct.toFixed(1)}%`} color={successPct >= 95 ? 'green' : 'red'} />
                <StatRow label="Fail"       value={`${(status.failRate * 100).toFixed(1)}%`} color={status.failRate > 0.05 ? 'red' : 'muted'} />
                <StatRow label="Total"      value={status.totalRequests.toLocaleString()} />
                <StatRow label="Multiplier" value={`${status.rateMultiplier}×`} highlight />
              </>
            ) : <p className="text-sm text-muted-foreground">Loading…</p>}
          </CardContent>
        </Card>

        {/* Controls */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Controls</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Lifecycle</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline"
                  className="border-[oklch(0.62_0.18_155)/40] text-[oklch(0.62_0.18_155)] hover:bg-[oklch(0.62_0.18_155)/10]"
                  onClick={() => action('/internal/traffic/runner/resume')}>
                  ▶ Resume
                </Button>
                <Button size="sm" variant="outline"
                  className="border-warning/40 text-warning hover:bg-warning/10"
                  onClick={() => action('/internal/traffic/runner/pause')}>
                  ⏸ Pause
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Rate multiplier</p>
              <div className="flex gap-2">
                <input
                  type="number" step="0.1" min="0.1" max="10" value={multiplier}
                  onChange={(e) => setMult(e.target.value)}
                  className="w-20 rounded-md border border-border bg-input px-2 py-1.5 text-sm font-mono text-foreground outline-none focus:ring-1 focus:ring-ring"
                />
                <Button size="sm" variant="outline" onClick={() => action('/internal/traffic/runner/rate', { multiplier: parseFloat(multiplier) })}>
                  Set ×
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Baseline config */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center justify-between">
              <span className="flex items-center gap-2">
                Baseline Config
                {config && <Badge variant="secondary" className="text-[10px] font-mono">v{config.version}</Badge>}
              </span>
              {!editing ? (
                <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => setEditing(true)}>Edit</Button>
              ) : (
                <div className="flex items-center gap-2">
                  {saveMsg && <span className={`text-xs ${saveMsg.ok ? 'text-[oklch(0.62_0.18_155)]' : 'text-destructive'}`}>{saveMsg.text}</span>}
                  <Button size="sm" variant="outline" className="text-xs h-7" onClick={saveConfig} disabled={saving}>
                    {saving ? 'Saving…' : 'Save'}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-xs h-7" onClick={cancelEdit}>Cancel</Button>
                </div>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {config ? (
              editing ? (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Base QPS" hint="req/s baseline" value={form.baseQps} type="number" min="1" step="1"
                    onChange={(v) => setForm((f) => ({ ...f, baseQps: v }))} />
                  <Field label="Peak mult." hint="spike factor" value={form.peakMultiplier} type="number" min="1" step="0.1"
                    onChange={(v) => setForm((f) => ({ ...f, peakMultiplier: v }))} />
                  <Field label="Cycle (min)" hint="wave period" value={form.cycleMinutes} type="number" min="1" step="1"
                    onChange={(v) => setForm((f) => ({ ...f, cycleMinutes: v }))} />
                  <Field label="Jitter %" hint="0–100" value={form.jitterPct} type="number" min="0" max="100" step="1"
                    onChange={(v) => setForm((f) => ({ ...f, jitterPct: v }))} />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <KVTile label="Base QPS"   value={String(config.baseQps)} />
                  <KVTile label="Peak mult." value={`${config.peakMultiplier}×`} />
                  <KVTile label="Cycle"      value={`${config.cycleMinutes} min`} />
                  <KVTile label="Jitter"     value={`${(config.jitterPct * 100).toFixed(0)}%`} />
                </div>
              )
            ) : <p className="text-sm text-muted-foreground">Loading…</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatRow({ label, value, highlight, color }: { label: string; value: string; highlight?: boolean; color?: 'green' | 'red' | 'muted' }) {
  const cls = color === 'green' ? 'text-[oklch(0.62_0.18_155)]' : color === 'red' ? 'text-destructive' : color === 'muted' ? 'text-muted-foreground' : '';
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono font-medium tabular-nums ${highlight ? 'text-primary' : cls}`}>{value}</span>
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
